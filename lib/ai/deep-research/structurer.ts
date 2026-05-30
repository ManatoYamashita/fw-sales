/**
 * Stage 2 構造化クライアント (deep-research-pipeline spec, Issue #43, Task 2.5)
 *
 * Stage 1 (Deep Research) が返す Markdown レポート + 引用 URL を、`gemini-2.5-flash-lite`
 * を `responseJsonSchema` で呼び出して 8 カテゴリ・51 項目 JSON へ構造化する。
 *
 * 設計上の判断:
 * - `responseMimeType: "application/json"` + `responseJsonSchema` を必須化 (構造保証)
 * - `tools` は付けない (既存 `lib/ai/client.ts:6-9` 制約遵守、Stage 1 で取得済みなので不要)
 * - 出力テキストを `JSON.parse` → Zod `safeParse` の二段検証
 * - `AiClientError` 系とは別系統の `StructurerError` を独立定義 (意味論を分離、
 *   research.md §Design Synthesis Generalization 判断)
 *
 * 関連: design.md §Components and Interfaces / Structurer, requirements.md
 *       §3.1, §3.2, §3.3, §3.4, §3.5
 */

import "server-only";

import { GoogleGenAI } from "@google/genai";
import type { ZodIssue, z } from "zod";
import {
  DeepResearchReportSchema,
  getDeepResearchJsonSchema,
} from "./schema";
import { buildDeepResearchPrompt } from "./prompt";
import { sanitizeMessage } from "./client";
import type { Store } from "@/types/store";
import { readEnv, getStructurerModel } from "@/lib/env";

export type StructurerError =
  | { kind: "missing_api_key" }
  | { kind: "timeout"; message?: string }
  | { kind: "rate_limit"; retryAfterSeconds?: number; message?: string }
  | { kind: "auth_error"; message?: string }
  | { kind: "api_error"; status: number; message?: string }
  | { kind: "network_error"; message?: string }
  | { kind: "schema_violation"; zodIssues: string[] }
  | { kind: "empty_response" }
  | {
      kind: "invalid_json";
      message: string;
      /** 応答 text の先頭 200 字 (truncation 時は "…(truncated)" 付き)。 */
      responsePreview?: string;
      /** 応答 text の全長 (`maxOutputTokens` cap 超過判定の手掛り)。 */
      responseLength?: number;
      /** Gemini API の `candidates[0].finishReason` (`MAX_TOKENS` 等)。 */
      finishReason?: string;
    }
  | { kind: "unknown"; message: string };

export interface StructurerInput {
  reportMarkdown: string;
  /** Stage 1 が返した引用 URL 群 (Stage 2 出力の `all_source_urls` に組み込む) */
  sourceUrls: string[];
  storeContext: Pick<
    Store,
    "name" | "prefecture" | "city" | "address" | "genre" | "site_url"
  >;
}

export type StructurerResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: StructurerError };

/** Zod が推論する DeepResearchReport (構造化前 raw 形)。アプリ層で使う `DeepResearchReport`
 *  (`types/deep-research.ts`) とは `id` 等の DB 派生フィールドの有無で差がある。 */
export type StructuredReport = z.infer<typeof DeepResearchReportSchema>;

export interface Structurer {
  structure(
    input: StructurerInput,
    signal: AbortSignal,
  ): Promise<StructurerResult<StructuredReport>>;
}

/**
 * SDK 応答テキストを JSON parse → Zod 検証する純関数。
 *
 * SDK モック不要でテスト可能にするため、SDK 呼出から分離している。
 * Stage 1 引用 URL のフォールバック補完もここで行う (LLM が `all_source_urls` を
 * 漏らした場合の保険)。
 */
export function parseAndValidateStructurerText(
  text: string | undefined | null,
  sourceUrlsFallback: string[],
  meta?: { finishReason?: string },
): StructurerResult<StructuredReport> {
  if (typeof text !== "string" || text.length === 0) {
    return { ok: false, error: { kind: "empty_response" } };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    const PREVIEW_LEN = 200;
    const responsePreview =
      text.length > PREVIEW_LEN
        ? `${text.slice(0, PREVIEW_LEN)}…(truncated)`
        : text;
    return {
      ok: false,
      error: {
        kind: "invalid_json",
        message: "Stage 2 の応答が JSON として解釈できませんでした",
        responsePreview,
        responseLength: text.length,
        ...(meta?.finishReason ? { finishReason: meta.finishReason } : {}),
      },
    };
  }

  if (
    parsed !== null &&
    typeof parsed === "object" &&
    !Array.isArray(parsed)
  ) {
    const obj = parsed as Record<string, unknown>;
    if (
      !Array.isArray(obj.all_source_urls) ||
      obj.all_source_urls.length === 0
    ) {
      obj.all_source_urls = dedupe(sourceUrlsFallback);
    }
  }

  const validated = DeepResearchReportSchema.safeParse(parsed);
  if (!validated.success) {
    return {
      ok: false,
      error: {
        kind: "schema_violation",
        zodIssues: validated.error.issues.map(formatIssue),
      },
    };
  }
  return { ok: true, data: validated.data };
}

/**
 * Structurer のデフォルト実装。各呼出ごとに `GoogleGenAI` インスタンスを生成する
 * (既存 `createGeminiClient()` と同じ判断、MVP では singleton 化しない)。
 */
export function createStructurer(): Structurer {
  return {
    async structure(input, signal) {
      const apiKey = readEnv("GEMINI_API_KEY");
      if (!apiKey) {
        return { ok: false, error: { kind: "missing_api_key" } };
      }
      const model = getStructurerModel();
      const ai = new GoogleGenAI({ apiKey });

      const prompts = buildDeepResearchPrompt({ store: input.storeContext });
      const { systemPrompt, userPrompt } = prompts.stage2(input.reportMarkdown);

      const jsonSchema = getDeepResearchJsonSchema();

      try {
        const response = await ai.models.generateContent({
          model,
          contents: [
            {
              role: "user",
              parts: [{ text: userPrompt }],
            },
          ],
          config: {
            systemInstruction: systemPrompt,
            responseMimeType: "application/json",
            responseJsonSchema: jsonSchema,
            temperature: 0.2,
            // 51 項目 × 各 ~200 token + 余裕で 16k 程度。8192 だと冗長な
            // Markdown 入力 (store データ貧弱なケース) で JSON 途中切断 →
            // invalid_json が観測されたため拡大 (PR 起票元: job_mpsfi8g0_nc3u5t)
            maxOutputTokens: 16384,
            abortSignal: signal,
          },
        });

        // candidates[0].finishReason は invalid_json 時のデバッグ手がかり
        // (MAX_TOKENS なら出力切断確定、STOP なら別原因)
        const rawFinishReason = (
          response as unknown as {
            candidates?: Array<{ finishReason?: unknown }>;
          }
        ).candidates?.[0]?.finishReason;
        const finishReason =
          typeof rawFinishReason === "string" ? rawFinishReason : undefined;

        return parseAndValidateStructurerText(
          response.text,
          input.sourceUrls,
          finishReason ? { finishReason } : undefined,
        );
      } catch (err) {
        return { ok: false, error: normalizeStructurerError(err) };
      }
    },
  };
}

function formatIssue(issue: ZodIssue): string {
  const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
  return `${path}: ${issue.message}`;
}

function dedupe(urls: string[]): string[] {
  return [...new Set(urls.filter((u) => typeof u === "string" && u.length > 0))];
}

/**
 * SDK 生エラーを `StructurerError` に正規化する。
 *
 * PR #71 の `normalizeSdkError` (Stage 1, `client.ts`) と同型ロジック：
 * - `@google/genai` の `ApiError` は `err.status: number` を直接持つので、regex より
 *   `err.name === "ApiError"` + `typeof err.status === "number"` で優先判定
 * - 各分岐で SDK の生メッセージを `sanitizeMessage` 経由で保持し、`error_log` に
 *   Gemini からの応答 body を残せるようにする (API キー値や request ID は
 *   `sanitizeMessage` 側で `***` 置換、R6.6)
 * - SDK モック不要のテストを可能にするため named export とする
 */
export function normalizeStructurerError(err: unknown): StructurerError {
  if (err instanceof DOMException && err.name === "AbortError") {
    return { kind: "timeout" };
  }
  if (err instanceof TypeError && err.message.toLowerCase().includes("fetch")) {
    return { kind: "network_error", message: sanitizeMessage(err.message) };
  }
  if (err instanceof Error) {
    const apiErr = err as Error & { status?: unknown; name?: string };
    if (
      (apiErr.name === "ApiError" || "status" in apiErr) &&
      typeof apiErr.status === "number"
    ) {
      const status = apiErr.status;
      const message = sanitizeMessage(err.message);
      if (status === 401 || status === 403) {
        return { kind: "auth_error", message };
      }
      if (status === 429) {
        return { kind: "rate_limit", message };
      }
      return { kind: "api_error", status, message };
    }
    const msg = err.message.toLowerCase();
    if (
      msg.includes("401") ||
      msg.includes("unauthorized") ||
      msg.includes("api key")
    ) {
      return { kind: "auth_error", message: sanitizeMessage(err.message) };
    }
    if (
      msg.includes("429") ||
      msg.includes("rate limit") ||
      msg.includes("quota")
    ) {
      return { kind: "rate_limit", message: sanitizeMessage(err.message) };
    }
    const statusMatch = err.message.match(/\b([45]\d\d)\b/);
    if (statusMatch && statusMatch[1] !== undefined) {
      const status = Number.parseInt(statusMatch[1], 10);
      if (Number.isFinite(status)) {
        return {
          kind: "api_error",
          status,
          message: sanitizeMessage(err.message),
        };
      }
    }
    return {
      kind: "unknown",
      message: sanitizeMessage(err.message),
    };
  }
  return {
    kind: "unknown",
    message: "Stage 2 構造化呼出で不明なエラーが発生しました",
  };
}
