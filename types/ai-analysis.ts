/**
 * AI 分析結果の型定義(`lib/ai/schema.ts` Zod スキーマからの re-export)。
 *
 * 単一情報源は `lib/ai/schema.ts`。本ファイルは型・定数の re-export ハブとして機能し、
 * `types/store.ts` 等の上位レイヤーが `lib/ai/*` への runtime 依存を持たずに型のみ参照できる。
 *
 * 関連: design.md §「Data Models / Logical Data Model」, requirements.md §3.1, §3.2, §3.3
 */

export {
  AiAnalysisSchema,
  AiAnalysisConfidenceSchema,
  ConfidenceField,
  CONFIDENCE_FIELDS,
  AI_ANALYSIS_PROPERTY_ORDERING,
  getAiAnalysisJsonSchema,
} from "@/lib/ai/schema";

export type {
  AiAnalysisResult,
  AiAnalysisConfidence,
  ConfidenceFieldKey,
} from "@/lib/ai/schema";
