/**
 * AI 分析結果の構造化出力型。
 *
 * 本ファイルは型定義の単一情報源を提供する。Task 2.1 で `lib/ai/schema.ts` に
 * Zod スキーマが新設された後は、本ファイルを `lib/ai/schema.ts` からの re-export に
 * 切替える(`AiAnalysisResult` / `AiAnalysisConfidence` を Zod の `z.infer` から派生させる)。
 *
 * 関連: design.md §「Data Models」「AiAnalysisSchema」, requirements.md §3.1, §3.2, §3.3
 */

/** 構造化出力の各フィールドに付与する確信度キー一覧。 */
export const CONFIDENCE_FIELDS = [
  "strengths",
  "weaknesses",
  "gourmet_paid_status",
  "gbp_completeness",
  "call_script",
] as const;

export type ConfidenceFieldKey = (typeof CONFIDENCE_FIELDS)[number];

/**
 * 各フィールドの確信度スコア (0-100 整数)。
 * UI 表示時に既存 `confidenceToBg` ヘルパで背景色に変換する。
 */
export interface AiAnalysisConfidence {
  strengths: number;
  weaknesses: number;
  gourmet_paid_status: number;
  gbp_completeness: number;
  call_script: number;
}

/**
 * AI 分析結果の構造化出力。
 * - strengths_markdown / weaknesses_markdown: Markdown 文字列
 * - 他 3 フィールド: プレーンテキスト
 * - call_script は最大 1500 文字 (Req 3.3、Task 2.1 で Zod により強制)
 */
export interface AiAnalysisResult {
  strengths_markdown: string;
  weaknesses_markdown: string;
  gourmet_paid_status: string;
  gbp_completeness: string;
  call_script: string;
  confidence: AiAnalysisConfidence;
}
