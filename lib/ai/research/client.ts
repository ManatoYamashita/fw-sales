/**
 * AI 店舗調査(Stage1 Source Discovery / Stage2 FACT・ANALYSIS)の Gemini API クライアント。
 * AI 店舗調査再設計(Plan v3.2 §8, PR2)。`import "server-only"` で隔離。
 *
 * `lib/ai/client.ts`(営業資産生成)とは責務が異なる独立モジュールとして実装する
 * (`lib/ai/client.ts` 冒頭 JSDoc 参照)。ただし SDK エラー正規化(`AiClientError` /
 * `normalizeSdkError` / `isAiClientError`)は同じ Gemini API を叩く以上ロジックを
 * 複製せず再利用する。
 *
 * Stage1: `tools:[{googleSearch:{}}]` のみ。Structured Output は使わない
 * (Spike 0.1 で groundingMetadata が失われないことを実証済み)。
 * Stage2: `tools:[{urlContext:{}}]` のみ(Google Searchは使わない)+ Structured Output
 * (Spike 0.1 Test A/C で urlContextMetadata が正常に返ることを実証済み)。
 */

import "server-only";

import { GoogleGenAI, FinishReason } from "@google/genai";
import { readEnv, getResearchGeminiModel, getResearchMaxOutputTokens } from "@/lib/env";
import {
  normalizeSdkError,
  makeError,
  extractProviderDiagnostics,
  type AiClientError,
} from "@/lib/ai/client";
import type { GroundingMetadataLike } from "./source-registry";

export interface UsageMetadataLike {
  promptTokenCount: number | null;
  candidatesTokenCount: number | null;
  toolUsePromptTokenCount: number | null;
  thoughtsTokenCount: number | null;
  totalTokenCount: number | null;
}

export interface UrlContextMetadataLike {
  urlMetadata: { retrievedUrl: string | null; status: string | null }[];
}

export interface Stage1CallResult {
  text: string;
  groundingMetadata: GroundingMetadataLike | null;
  usageMetadata: UsageMetadataLike | null;
  /**
   * Google Search のserver-side tool call回数(fix/ai-research-poc-like-retrieval で追加)。
   * `groundingMetadata` が欠落する場合でも(Spike 0.2で実証済みの実機挙動)、
   * 「Searchを呼ばなかった」のか「呼んだが結果が空だった」のかを事後に区別するための
   * 最低限の診断情報。検索クエリ文字列そのものは保存しない(件数のみ)。
   */
  searchCallCount: number;
  /** 上記tool callに含まれた検索クエリの合計件数。 */
  searchQueryCount: number;
}

export interface Stage2CallResult {
  rawText: string;
  urlContextMetadata: UrlContextMetadataLike | null;
  usageMetadata: UsageMetadataLike | null;
}

export interface ResearchGeminiClient {
  /** Stage1: Google Search単独。Structured Outputは使わない。 */
  runSourceDiscovery(prompt: string, signal: AbortSignal): Promise<Stage1CallResult>;
  /** Stage2: URL Context単独 + Structured Output。 */
  runStructuredUrlContext(
    params: { prompt: string; jsonSchema: Record<string, unknown> },
    signal: AbortSignal,
  ): Promise<Stage2CallResult>;
}

/**
 * server-side tool invocation parts(`toolConfig.includeServerSideToolInvocations`有効時に
 * 含まれる)から、Google Searchの呼出回数・クエリ件数のみを抽出する。
 * クエリ文字列そのものはここで破棄し、件数だけを返す(個人情報・生レスポンス非保存の方針)。
 */
function extractSearchDiagnostics(
  parts: unknown,
): { searchCallCount: number; searchQueryCount: number } {
  if (!Array.isArray(parts)) return { searchCallCount: 0, searchQueryCount: 0 };

  let searchCallCount = 0;
  let searchQueryCount = 0;
  for (const part of parts as Array<{ toolCall?: { args?: Record<string, unknown> } }>) {
    const args = part.toolCall?.args;
    if (!args) continue;
    searchCallCount += 1;
    const queries = args.queries;
    if (Array.isArray(queries)) {
      searchQueryCount += queries.length;
    }
  }
  return { searchCallCount, searchQueryCount };
}

function extractUsageMetadata(um: unknown): UsageMetadataLike | null {
  if (!um || typeof um !== "object") return null;
  const u = um as Record<string, unknown>;
  return {
    promptTokenCount: typeof u.promptTokenCount === "number" ? u.promptTokenCount : null,
    candidatesTokenCount:
      typeof u.candidatesTokenCount === "number" ? u.candidatesTokenCount : null,
    toolUsePromptTokenCount:
      typeof u.toolUsePromptTokenCount === "number" ? u.toolUsePromptTokenCount : null,
    thoughtsTokenCount: typeof u.thoughtsTokenCount === "number" ? u.thoughtsTokenCount : null,
    totalTokenCount: typeof u.totalTokenCount === "number" ? u.totalTokenCount : null,
  };
}

/**
 * Gemini 呼出失敗を **sanitized な structured log** として記録する
 * (runtime reliability hardening、F3/F4)。
 *
 * 従来 `lib/ai/` と `workflows/` には `console.*` が 1 つも無く、Gemini がどの HTTP status /
 * provider reason で落ちたかは Vercel logs に残らなかった。2026-08 の billing 障害では
 * `store_research_runs.error_kind` を Supabase で直接見るしか診断手段がなく、しかもその値は
 * `fatal:rate_limit` で「一時的な rate limit」と区別がつかなかった。
 *
 * ここが provider 側の生情報に触れられる最後の地点なので、`extractProviderDiagnostics`
 * を通した列挙トークンだけをログへ出す。**`AiClientError` には載せない**
 * (DB `error_message` / UI へ流出させないため)。
 *
 * 制約:
 * - 元 Error オブジェクトを `console.error` へ渡さない(スタックや raw message が出る)。
 * - raw `err.message` / レスポンス本文 / request ID / API key / headers は出さない。
 * - `AiClientError` の `message` フィールド(`unknown` kind が持つ定型文)も出さない。
 */
function logGeminiCallFailure(stage: "stage1" | "stage2", err: unknown, kind: AiClientError["kind"]): void {
  console.error("[research.gemini] call failed", {
    stage,
    kind,
    ...extractProviderDiagnostics(err),
  });
}

/**
 * MAX_TOKENS 到達時の token 内訳を **sanitized な structured log** として記録する
 * (feat/ai-research-quality-ux-hardening、Theme 5B)。
 *
 * 実機の MAX_TOKENS run では `token_usage = null` で、
 * 「thinking が伸びたのか candidates が伸びたのか」を事後に切り分けられなかった。
 * 出力枠(`maxOutputTokens`)を消費するのは `thoughtsTokenCount + candidatesTokenCount`
 * だけであり(`toolUsePromptTokenCount` / `promptTokenCount` は入力側)、
 * この内訳が無いと対策(上限引き上げ / 出力圧縮 / 分割)のどれが必要か判断できない。
 *
 * **数値と設定値のみ。** raw response 本文・candidate text・prompt 本文・URL は出さない
 * (`logGeminiCallFailure` と同じ規約)。
 */
function logMaxTokens(stage: "stage1" | "stage2", usage: UsageMetadataLike | null): void {
  console.error("[research.gemini] max_tokens", {
    stage,
    configured_max_output_tokens: getResearchMaxOutputTokens(),
    prompt_token_count: usage?.promptTokenCount ?? null,
    thoughts_token_count: usage?.thoughtsTokenCount ?? null,
    candidates_token_count: usage?.candidatesTokenCount ?? null,
    tool_use_prompt_token_count: usage?.toolUsePromptTokenCount ?? null,
    total_token_count: usage?.totalTokenCount ?? null,
  });
}

/**
 * SDK 生エラーを正規化しつつ、失敗を sanitized にログへ残す。
 * 正規化後の `AiClientError` の内容は従来と一切変わらない(分類ロジックは無変更)。
 */
function normalizeAndLog(stage: "stage1" | "stage2", err: unknown): AiClientError {
  const normalized = normalizeSdkError(err);
  logGeminiCallFailure(stage, err, normalized.kind);
  return normalized;
}

export function createResearchGeminiClient(): ResearchGeminiClient {
  return {
    async runSourceDiscovery(prompt, signal) {
      const apiKey = readEnv("GEMINI_API_KEY");
      if (!apiKey) throw makeError({ kind: "missing_api_key" });

      const model = getResearchGeminiModel();
      const ai = new GoogleGenAI({ apiKey });

      try {
        const response = await ai.models.generateContent({
          model,
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          config: {
            tools: [{ googleSearch: {} }],
            // Search診断情報(searchCallCount/searchQueryCount)取得のため有効化。
            // groundingMetadataの代替source of truthにはしない(あくまで診断用)。
            toolConfig: { includeServerSideToolInvocations: true },
            maxOutputTokens: getResearchMaxOutputTokens(),
            abortSignal: signal,
          },
        });

        const text = response.text;
        if (typeof text !== "string" || text.length === 0) {
          throw makeError({ kind: "unknown", message: "Source Discovery の応答が空でした" });
        }

        const candidate = response.candidates?.[0];
        const { searchCallCount, searchQueryCount } = extractSearchDiagnostics(
          candidate?.content?.parts,
        );

        return {
          text,
          groundingMetadata: (candidate?.groundingMetadata as GroundingMetadataLike | undefined) ?? null,
          usageMetadata: extractUsageMetadata(response.usageMetadata),
          searchCallCount,
          searchQueryCount,
        };
      } catch (err) {
        throw normalizeAndLog("stage1", err);
      }
    },

    async runStructuredUrlContext({ prompt, jsonSchema }, signal) {
      const apiKey = readEnv("GEMINI_API_KEY");
      if (!apiKey) throw makeError({ kind: "missing_api_key" });

      const model = getResearchGeminiModel();
      const ai = new GoogleGenAI({ apiKey });

      try {
        const response = await ai.models.generateContent({
          model,
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          config: {
            tools: [{ urlContext: {} }],
            responseMimeType: "application/json",
            responseJsonSchema: jsonSchema,
            maxOutputTokens: getResearchMaxOutputTokens(),
            abortSignal: signal,
          },
        });

        const candidate = response.candidates?.[0];

        // 長さ上限による打ち切りを、空応答/JSON parse失敗より先に専用分類へ落とす。
        // Gemini 3系はthinkingが既定で有効で、thinking tokenも出力枠(maxOutputTokens)を
        // 消費するため、41項目Combinedの出力途中でJSON が閉じられないまま打ち切られうる
        // (実機smoke testで thoughtsTokenCount+candidatesTokenCount が上限に到達し、
        // 後続のJSON.parseが構文エラーになる事象を確認済み)。ここで検出しないと
        // 「JSON parse failure」と「出力token上限」が区別できなくなる。
        if (candidate?.finishReason === FinishReason.MAX_TOKENS) {
          // feat/ai-research-quality-ux-hardening(Theme 5B): この時点では
          // `response.usageMetadata` がスコープ内にあり、thinking と candidates の
          // どちらが枠を食い潰したかを**数値だけ**取り出せる。従来はここで読まずに
          // throw していたため `token_usage = null` になり、対策の効果測定ができなかった。
          const usage = extractUsageMetadata(response.usageMetadata);
          logMaxTokens("stage2", usage);
          throw makeError({ kind: "max_tokens", usage: usage ?? undefined });
        }

        const rawText = response.text;
        if (typeof rawText !== "string" || rawText.length === 0) {
          throw makeError({ kind: "unknown", message: "Stage2 の応答が空でした" });
        }

        const ucm = candidate?.urlContextMetadata as
          | { urlMetadata?: { retrievedUrl?: string | null; urlRetrievalStatus?: string | null }[] }
          | undefined;

        return {
          rawText,
          urlContextMetadata: ucm
            ? {
                urlMetadata: (ucm.urlMetadata ?? []).map((u) => ({
                  retrievedUrl: u.retrievedUrl ?? null,
                  status: u.urlRetrievalStatus ?? null,
                })),
              }
            : null,
          usageMetadata: extractUsageMetadata(response.usageMetadata),
        };
      } catch (err) {
        throw normalizeAndLog("stage2", err);
      }
    },
  };
}

export type { AiClientError };
export { isAiClientError } from "@/lib/ai/client";
