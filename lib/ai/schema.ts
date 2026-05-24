/**
 * AI 分析結果の Zod スキーマと JSON Schema 変換ユーティリティ。
 *
 * 本ファイルが `AiAnalysisResult` 型と JSON Schema の **単一情報源** である。
 * `types/ai-analysis.ts` は本ファイルからの type-only re-export として機能し、
 * runtime 依存は本ファイルにのみ集約される。
 *
 * 関連: design.md §「AI Service Layer / AiAnalysisSchema」, requirements.md §3.1, §3.2, §3.3
 */

import { z } from "zod";
import {
  stripUnsupportedKeys,
  withPropertyOrdering,
} from "@/lib/ai/_shared/json-schema-utils";

/** 確信度フィールドの Zod 型(0-100 整数)。Req 3.2 を強制。 */
export const ConfidenceField = z.number().int().min(0).max(100);

/** 5 フィールドの確信度を持つネストオブジェクトのスキーマ。 */
export const AiAnalysisConfidenceSchema = z.object({
  strengths: ConfidenceField,
  weaknesses: ConfidenceField,
  gourmet_paid_status: ConfidenceField,
  gbp_completeness: ConfidenceField,
  call_script: ConfidenceField,
});

/**
 * AI 分析結果の Zod スキーマ。strict() で extra props を拒否する(Req 3.5)。
 *
 * - strengths_markdown / weaknesses_markdown: Markdown 文字列
 * - gourmet_paid_status / gbp_completeness / call_script: プレーンテキスト
 * - call_script は最大 1500 文字(Req 3.3)
 */
export const AiAnalysisSchema = z
  .object({
    strengths_markdown: z
      .string()
      .describe(
        "店舗の強みを Markdown 形式で。見出しは ## まで、箇条書きは - を使用。1〜3 セクション、合計 300〜600 字。コードブロック禁止。",
      ),
    weaknesses_markdown: z
      .string()
      .describe(
        "店舗の弱みを Markdown 形式で。同上の規約。",
      ),
    gourmet_paid_status: z
      .string()
      .describe(
        "グルメサイト課金状況。プレーンテキスト 1〜3 行(食べログ 050 番号判定等)。",
      ),
    gbp_completeness: z
      .string()
      .describe(
        "GBP (Google ビジネスプロフィール) 充実度。説明欄/口コミ返信/メニュー/最近の写真の有無を箇条書きしたプレーンテキスト。",
      ),
    call_script: z
      .string()
      .max(1500)
      .describe(
        "架電スクリプト。プレーンテキスト 1500 字以内。冒頭は assigned_sales 名を差し込む。改行は \\n を使用。",
      ),
    confidence: AiAnalysisConfidenceSchema,
  })
  .strict();

/** AI 分析結果の TypeScript 型(Zod から導出)。 */
export type AiAnalysisResult = z.infer<typeof AiAnalysisSchema>;

/** 確信度フィールドの TypeScript 型(Zod から導出)。 */
export type AiAnalysisConfidence = z.infer<typeof AiAnalysisConfidenceSchema>;

/** 確信度フィールドのキー一覧(UI 横断で使用)。 */
export const CONFIDENCE_FIELDS = [
  "strengths",
  "weaknesses",
  "gourmet_paid_status",
  "gbp_completeness",
  "call_script",
] as const;

export type ConfidenceFieldKey = (typeof CONFIDENCE_FIELDS)[number];

/**
 * Gemini API の `responseJsonSchema` に渡すフィールドの順序を明示する。
 *
 * `propertyOrdering` を JSON Schema に埋込まないと、Gemini が生成する JSON の
 * フィールド順がぶれて Markdown 内容が混線する事象が報告されている(research.md Topic 2)。
 */
export const AI_ANALYSIS_PROPERTY_ORDERING = [
  "strengths_markdown",
  "weaknesses_markdown",
  "gourmet_paid_status",
  "gbp_completeness",
  "call_script",
  "confidence",
] as const;

/**
 * Gemini API に渡す JSON Schema を返す。
 *
 * `responseJsonSchema` フィールドに直接渡す前提で、`propertyOrdering` を明示する。
 * クライアント側では `validateAiAnalysis()` (`lib/ai/validate.ts`) で再検証するため、
 * API 側の schema 強制は補助的扱い(Req 3.5、research.md Decision 3)。
 *
 * Zod の `z.toJSONSchema()` は `$schema` / `maxLength` 等を出力するが、Gemini API は
 * 限定的な subset しかサポートせず、非対応 key を含むと 400 を返す。
 * `lib/ai/_shared/json-schema-utils.ts` の `stripUnsupportedKeys` で除去してから
 * API に渡す (deep-research-pipeline spec で共通化、Issue #43 Task 2.1)。
 */
export function getAiAnalysisJsonSchema(): Record<string, unknown> {
  // Zod 4 内蔵の `z.toJSONSchema()` を使用(`zod-to-json-schema` v3.x は zod 4 と型互換性なし)。
  // Gemini API は JSON Schema Draft 2020-12 を受けるため、デフォルトの target で OK。
  const raw = z.toJSONSchema(AiAnalysisSchema, {
    target: "draft-2020-12",
  });
  const stripped = stripUnsupportedKeys(raw) as Record<string, unknown>;
  return withPropertyOrdering(stripped, AI_ANALYSIS_PROPERTY_ORDERING);
}
