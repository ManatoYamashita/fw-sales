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

import { GoogleGenAI } from "@google/genai";
import { readEnv, getResearchGeminiModel, getResearchMaxOutputTokens } from "@/lib/env";
import { normalizeSdkError, makeError, type AiClientError } from "@/lib/ai/client";
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
            maxOutputTokens: getResearchMaxOutputTokens(),
            abortSignal: signal,
          },
        });

        const text = response.text;
        if (typeof text !== "string" || text.length === 0) {
          throw makeError({ kind: "unknown", message: "Source Discovery の応答が空でした" });
        }

        const candidate = response.candidates?.[0];
        return {
          text,
          groundingMetadata: (candidate?.groundingMetadata as GroundingMetadataLike | undefined) ?? null,
          usageMetadata: extractUsageMetadata(response.usageMetadata),
        };
      } catch (err) {
        throw normalizeSdkError(err);
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

        const rawText = response.text;
        if (typeof rawText !== "string" || rawText.length === 0) {
          throw makeError({ kind: "unknown", message: "Stage2 の応答が空でした" });
        }

        const candidate = response.candidates?.[0];
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
        throw normalizeSdkError(err);
      }
    },
  };
}

export type { AiClientError };
export { isAiClientError } from "@/lib/ai/client";
