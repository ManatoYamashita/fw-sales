/**
 * 永続監査ログ (`event_logs`) へ記録する業務イベントの一覧。
 *
 * `stores.*` は Phase 1 (#36)、`research.*` は AI 調査の起動とレビュー (#320)。
 * payload には店舗情報の値そのもの (住所・電話番号・採用した値など) を入れない。
 * 項目キー・件数・判断の種類・上書きの有無までに留める。
 */
export const AUDIT_EVENTS = {
  salesProgressUpdate: "stores.salesProgress.update",
  storeDelete: "stores.delete",
  authzDenied: "authz.denied",
  researchRunStart: "research.run.start",
  researchReviewDecide: "research.review.decide",
  researchReviewBulkAdopt: "research.review.bulkAdopt",
  researchReviewComplete: "research.review.complete",
} as const;

export const SALES_PROGRESS_FIELDS = [
  "appointment_acquired_date",
  "assigned_sales_user_id",
  "memo",
] as const;
export type SalesProgressField = (typeof SALES_PROGRESS_FIELDS)[number];
export type AuditOperation = typeof AUDIT_EVENTS.salesProgressUpdate | typeof AUDIT_EVENTS.storeDelete;
export type DenialReason = "unauthenticated" | "not_admin";

/** 採用した値が基本情報をどう変えたか (`classifyAdoptionEffect` の判定をそのまま使う)。 */
export const ADOPTION_EFFECT_KINDS = ["new", "same", "overwrite"] as const;
export type AdoptionEffectKind = (typeof ADOPTION_EFFECT_KINDS)[number];
/** 上書きされた値の出どころ (`describeBasicInfoOrigin`)。値そのものは残さない。 */
export const OVERWRITTEN_ORIGINS = ["places", "typed", "adopted"] as const;
export type OverwrittenOrigin = (typeof OVERWRITTEN_ORIGINS)[number];

/**
 * レビュー完了の方式。
 * - `all_decided`    : 全項目を判断してから「調査完了」
 * - `skip_remaining` : 未判断の項目をスキップ扱いにして完了
 * - `adopt_bulk`     : 主ボタン「N件を採用して調査完了」
 */
export const REVIEW_COMPLETION_METHODS = ["all_decided", "skip_remaining", "adopt_bulk"] as const;
export type ReviewCompletionMethod = (typeof REVIEW_COMPLETION_METHODS)[number];

export type ResearchRunStartPayload = {
  /** 期限切れで失敗扱いにしてから再調査した場合の、前回 run の ID。 */
  stuckRunFailedId: string | null;
};
export type ResearchReviewDecidePayload =
  | { itemKey: string; decision: "rejected" | "skipped" }
  | {
    itemKey: string;
    decision: "adopted";
    effect: AdoptionEffectKind;
    /** `effect === "overwrite"` のときだけ値が入る。 */
    overwrittenOrigin: OverwrittenOrigin | null;
    /** 「編集して採用」で調査の値と異なる値を入れたか。 */
    edited: boolean;
  };
export type ResearchReviewBulkAdoptPayload = {
  itemKeys: string[];
  effectCounts: Record<AdoptionEffectKind, number>;
};
export type ResearchReviewCompletePayload = {
  method: ReviewCompletionMethod;
  /** 完了時点の判断の内訳 (このレビューで記録された全項目)。 */
  adoptedCount: number;
  rejectedCount: number;
  skippedCount: number;
  /** `skippedCount` のうち、完了操作がスキップ扱いにした件数。 */
  autoSkippedCount: number;
  /** 店舗の段階を「未調査」から「調査済み」へ進めたか。 */
  stageAdvanced: boolean;
};

export type ActorSnapshot = { userId: string; email: string };
export type AuditPayload =
  | { changedFields: SalesProgressField[] }
  | { deletionSucceeded: true }
  | { operation: AuditOperation; reason: DenialReason }
  | ResearchRunStartPayload
  | ResearchReviewDecidePayload
  | ResearchReviewBulkAdoptPayload
  | ResearchReviewCompletePayload;

/** AI 調査のイベントは run を対象 (`target_type: "research_run"`, `target_id: runId`) として記録する。 */
type ResearchAuditInput<E, P> = { event: E; actor: ActorSnapshot; storeId: string; runId: string; payload: P };

export type AuditInput =
  | { event: typeof AUDIT_EVENTS.salesProgressUpdate; actor: ActorSnapshot; storeId: string; payload: { changedFields: SalesProgressField[] } }
  | { event: typeof AUDIT_EVENTS.storeDelete; actor: ActorSnapshot; storeId: string; payload: { deletionSucceeded: true } }
  | { event: typeof AUDIT_EVENTS.authzDenied; actor: ActorSnapshot | null; storeId: null; payload: { operation: AuditOperation; reason: DenialReason } }
  | ResearchAuditInput<typeof AUDIT_EVENTS.researchRunStart, ResearchRunStartPayload>
  | ResearchAuditInput<typeof AUDIT_EVENTS.researchReviewDecide, ResearchReviewDecidePayload>
  | ResearchAuditInput<typeof AUDIT_EVENTS.researchReviewBulkAdopt, ResearchReviewBulkAdoptPayload>
  | ResearchAuditInput<typeof AUDIT_EVENTS.researchReviewComplete, ResearchReviewCompletePayload>;

export type AuditError = { name: string; message: string; stack?: string };
