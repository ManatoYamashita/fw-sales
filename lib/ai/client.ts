/**
 * `@google/genai` SDK のラッパ。Server Action からのみ呼出される(`"server-only"` で隔離)。
 *
 * - API キーは `process.env.GEMINI_API_KEY`(`lib/env.ts` の `readEnv` 経由)
 * - `responseMimeType: "application/json"` + `responseJsonSchema` で構造化出力を強制
 * - **URL Context Tool は使用しない** — Gemini API は構造化出力(`responseMimeType:
 *   "application/json"` + `responseJsonSchema`)と `tools` の同時設定を 400
 *   (INVALID_ARGUMENT) で拒否する。SDK の TS 型は `unknown` で受けるが実機 API で発覚。
 *   ページの主データは `prompt.ts` で HTML 全文を user Part として投入済(主軸経路)。
 * - SDK の生エラーは `AiClientError` discriminated union に正規化
 *   (API キー値や request ID の漏洩防止)
 *
 * 関連: design.md §「GeminiClient」, requirements.md §2.4, §2.6, §2.7, §6.1,
 *       research.md Topic 2(URL Context 制約の訂正)
 */

import "server-only";

import { GoogleGenAI, type Part } from "@google/genai";
import {
  isApiKeyConfigured as envIsApiKeyConfigured,
  getGeminiModel,
  readEnv,
} from "@/lib/env";

export interface AnalysisInput {
  /** PromptBuilder が生成した system prompt 文字列 */
  systemPrompt: string;
  /** PromptBuilder が生成した user message Parts(JSON 化されたフォーム値、HTML、追加指示) */
  userParts: Part[];
  /** `lib/ai/schema.ts:getAiAnalysisJsonSchema()` で生成した JSON Schema */
  jsonSchema: Record<string, unknown>;
}

/**
 * SDK エラーを正規化した discriminated union。
 *
 * Server Action 層ではこの kind を見て `ActionResult.failure(message)` に変換する。
 * SDK の生エラーメッセージには API キー値や request ID が混入することがあるため、
 * 必ず本型に変換してから上位に流すこと。
 */
export type AiClientError =
  | { kind: "missing_api_key" }
  | { kind: "timeout" }
  | { kind: "rate_limit"; retryAfterSeconds?: number }
  | { kind: "auth_error" }
  | { kind: "api_error"; status: number }
  | { kind: "network_error" }
  | { kind: "unknown"; message: string };

export interface GeminiClient {
  /**
   * Gemini API を呼出して raw な JSON レスポンスを返す。
   *
   * - 成功時は parsed object(`unknown` 型、呼出元で `validateAiAnalysis()` を通すこと)
   * - 失敗時は `AiClientError` を throw
   * - `signal` は AbortController.signal を期待(60 秒タイムアウト等の中断制御)
   */
  generateAnalysis(
    input: AnalysisInput,
    signal: AbortSignal,
  ): Promise<unknown>;
}

/**
 * API キーが設定済みかを返す。`lib/env.ts` の同名関数を再 export する形。
 *
 * Client Component から SSR 経由で boolean を受け取り、`[AI で分析]` ボタンの
 * disabled 制御に使う想定(Req 2.7)。本関数は Server / Client いずれからも安全に呼べる
 * (`lib/env.ts` は `server-only` 隔離していないため)。
 */
export function isApiKeyConfigured(): boolean {
  return envIsApiKeyConfigured();
}

/**
 * Gemini Client を生成する。各呼出ごとに新規 SDK インスタンスを作る。
 *
 * インスタンスを reuse する singleton 化でレイテンシ短縮の余地があるが、
 * MVP では呼出毎に生成して動作確認後に最適化を検討する(tasks.md Implementation Notes 参照)。
 */
export function createGeminiClient(): GeminiClient {
  return {
    async generateAnalysis(input, signal) {
      const apiKey = readEnv("GEMINI_API_KEY");
      if (!apiKey) {
        throw makeError({ kind: "missing_api_key" });
      }
      const model = getGeminiModel();
      const ai = new GoogleGenAI({ apiKey });

      try {
        const response = await ai.models.generateContent({
          model,
          contents: [
            {
              role: "user",
              parts: input.userParts,
            },
          ],
          config: {
            systemInstruction: input.systemPrompt,
            responseMimeType: "application/json",
            responseJsonSchema: input.jsonSchema,
            temperature: 0.4,
            maxOutputTokens: 4096,
            abortSignal: signal,
          },
        });

        const text = response.text;
        if (typeof text !== "string" || text.length === 0) {
          throw makeError({
            kind: "unknown",
            message: "AI 分析の応答が空でした",
          });
        }
        return JSON.parse(text);
      } catch (err) {
        if (process.env.NODE_ENV !== "production") {
          console.error("[ai/client] generateAnalysis raw error:", err);
          if (err instanceof Error) {
            console.error("[ai/client] error.message:", err.message);
            console.error("[ai/client] error.stack:", err.stack);
          }
        }
        throw normalizeSdkError(err);
      }
    },
  };
}

/**
 * SDK 生エラーを `AiClientError` に正規化する。
 *
 * 重要: 生エラーメッセージには API キー先頭文字や internal request ID が混入することがある。
 * 必ず正規化済メッセージのみを上位に返すこと(client / log への漏洩防止)。
 */
function normalizeSdkError(err: unknown): AiClientError {
  // 既に正規化済の AiClientError(makeError 経由)はそのまま再 throw
  if (isAiClientError(err)) {
    return err;
  }
  // AbortSignal によるキャンセル → timeout
  if (err instanceof DOMException && err.name === "AbortError") {
    return { kind: "timeout" };
  }
  // fetch ネットワーク失敗
  if (err instanceof TypeError && err.message.toLowerCase().includes("fetch")) {
    return { kind: "network_error" };
  }
  // SDK が Error に乗せてくるメッセージから分類
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (
      msg.includes("401") ||
      msg.includes("unauthorized") ||
      msg.includes("api key")
    ) {
      return { kind: "auth_error" };
    }
    if (
      msg.includes("429") ||
      msg.includes("rate limit") ||
      msg.includes("quota")
    ) {
      return { kind: "rate_limit" };
    }
    const statusMatch = err.message.match(/\b([45]\d\d)\b/);
    if (statusMatch && statusMatch[1] !== undefined) {
      const status = Number.parseInt(statusMatch[1], 10);
      if (Number.isFinite(status)) {
        return { kind: "api_error", status };
      }
    }
    return {
      kind: "unknown",
      message: "AI 分析の呼出でエラーが発生しました",
    };
  }
  return {
    kind: "unknown",
    message: "AI 分析の呼出で不明なエラーが発生しました",
  };
}

function makeError(err: AiClientError): AiClientError {
  return err;
}

function isAiClientError(err: unknown): err is AiClientError {
  if (typeof err !== "object" || err === null) return false;
  if (!("kind" in err)) return false;
  const kind = (err as { kind: unknown }).kind;
  return (
    kind === "missing_api_key" ||
    kind === "timeout" ||
    kind === "rate_limit" ||
    kind === "auth_error" ||
    kind === "api_error" ||
    kind === "network_error" ||
    kind === "unknown"
  );
}
