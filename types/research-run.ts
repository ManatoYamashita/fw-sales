/**
 * `store_research_runs` の型定義(AI 店舗調査再設計 Plan v3.2, PR1: データモデル基盤)。
 *
 * `ResearchItem` / `SourceRegistryEntry` / `ReviewDecision` 等の単一情報源は
 * `lib/ai/research-result-schema.ts`(Zod)。本ファイルは type-only re-export
 * ハブとして機能し、`lib/db/schema.ts` 等の上位レイヤーが `lib/ai/*` への
 * runtime 依存を持たずに型のみ参照できる(`types/ai-analysis.ts` と同じパターン)。
 *
 * 関連: Plan v3.2 §12, §13, §15
 */

export {
  RESEARCH_STATUSES,
  REVIEW_DECISION_TYPES,
  SOURCE_TYPES,
  RESOLVE_STATUSES,
  URL_CONTEXT_STATUSES,
  DISCOVERY_PROVENANCES,
  SourceRegistryEntrySchema,
  ResearchItemCandidateSchema,
  ResearchItemSchema,
  ResearchItemsSchema,
  ReviewDecisionSchema,
  ReviewDecisionsSchema,
  isValidReviewDecisionForItem,
  enforceResearchPolicy,
  sanitizeSourceIds,
  validateConflictShape,
  validateResearchItemStatus,
  applyDeterministicValidation,
  validateResearchItems,
} from "@/lib/ai/research-result-schema";

export type {
  ResearchStatus,
  SourceType,
  ResolveStatus,
  UrlContextStatus,
  DiscoveryProvenance,
  SourceRegistryEntry,
  ResearchItemCandidate,
  ResearchItem,
  ReviewDecisionType,
  ReviewDecision,
  ReviewDecisions,
  ResearchValidationContext,
} from "@/lib/ai/research-result-schema";

/** `store_research_runs.status`(技術的job status)。Plan v3.2 §15。 */
export const STORE_RESEARCH_RUN_STATUSES = ["running", "succeeded", "failed"] as const;
export type StoreResearchRunStatus = (typeof STORE_RESEARCH_RUN_STATUSES)[number];

/** `store_research_runs.stage`(進捗表示用サブステート、running中のみ意味を持つ)。Plan v3.2 §15。 */
export const STORE_RESEARCH_RUN_STAGES = ["discovering", "researching", "done"] as const;
export type StoreResearchRunStage = (typeof STORE_RESEARCH_RUN_STAGES)[number];

/**
 * `store_research_runs` 1行分。Plan v3.2 §12 のスキーマと 1:1 対応する。
 *
 * - `result` / `token_usage` は run 未完了時 `null`。
 * - `source_registry` / `review_decisions` / `warnings` は未設定時も空配列/空オブジェクト
 *   (basic_info の jsonb 規約に揃える、DEFAULT NOT NULL)。
 * - `started_at` / `expires_at` / `finished_at` は ISO 8601 文字列(timestamptz 列)。
 *   他テーブルの `YYYY-MM-DD` text 規約とは意図的に異なる型を採用する
 *   (所要時間の算出・stuck run 検出に日単位粒度では不十分なため)。
 */
export interface StoreResearchRun {
  id: string;
  store_id: string;
  /** 起動者の監査用。`profiles.id`。未設定(システム起動等)は null。 */
  requested_by_user_id: string | null;
  status: StoreResearchRunStatus;
  stage: StoreResearchRunStage | null;
  result: import("@/lib/ai/research-result-schema").ResearchItem[] | null;
  source_registry: import("@/lib/ai/research-result-schema").SourceRegistryEntry[];
  review_decisions: import("@/lib/ai/research-result-schema").ReviewDecisions;
  /** 明示的な「レビュー完了」操作の記録。null = レビュー未完了(Plan §6 の「要確認」判定に使用)。 */
  review_completed_at: string | null;
  /** Stage毎のトークン使用量記録(コスト監視用)。形状は PR2 のパイプライン実装側で確定する。 */
  token_usage: Record<string, unknown> | null;
  /**
   * run単位の非致命的な警告(例: Places軽量再同期の失敗通知)。個別項目の警告は
   * `ResearchItem.warning` 側に持つため、本フィールドは項目に紐付かない run 全体の
   * 警告のみを保持する。
   */
  warnings: string[];
  /** `AiClientError` と同種の正規化済みエラー種別。 */
  error_kind: string | null;
  error_message: string | null;
  started_at: string;
  /**
   * `started_at` + 想定所要時間の安全マージン。stuck run 検出に使用(Plan §17)。
   * Vercel Workflow 採用によりこの列の第一義的な役割(waitUntil 時代の lazy sweep
   * による能動的失敗遷移)は後退するが、Workflow 自体には「run が想定より
   * 明らかに長く running のまま」を機械的に検知する固有の仕組みが無いため、
   * 監査・異常検知用の軽量な参考値として引き続き保持する(PR1 では計算・保存のみ、
   * 実際の検知・遷移ロジックは PR2/PR3 で実装する)。
   */
  expires_at: string;
  finished_at: string | null;
}

/** `create` 時の入力。その他の列はリポジトリ側で既定値を計算する。 */
export interface StoreResearchRunInput {
  store_id: string;
  requested_by_user_id: string | null;
}

/** `update` 時の部分更新。`id` / `store_id` / `requested_by_user_id` / `started_at` / `expires_at` は不変。 */
export type StoreResearchRunPatch = Partial<
  Pick<
    StoreResearchRun,
    | "status"
    | "stage"
    | "result"
    | "source_registry"
    | "review_decisions"
    | "review_completed_at"
    | "token_usage"
    | "warnings"
    | "error_kind"
    | "error_message"
    | "finished_at"
  >
>;
