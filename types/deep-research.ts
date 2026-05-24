/**
 * deep-research-pipeline ドメイン型 (Issue #43)
 *
 * `lib/db/schema.ts` の `researchJobs` / `researchReports` テーブルと 1:1 対応する
 * アプリ層型。テーブル名と異なり、TS 側では `DeepResearchJob` / `DeepResearchReport`
 * のプレフィックスを使い、既存の `Research` (旧来の手動調査エンティティ) との
 * 混同を避ける。
 *
 * 関連: design.md §Data Models, requirements.md §1.x, §2.3, §3.x, §5.x, §8.x
 */

/**
 * ジョブの状態。`research_jobs.status` 列の取りうる値。
 * 遷移許容ペア: queued→researching→structuring→done、任意→failed。
 * 自動リトライは行わず、failed からは `retryDeepResearchAction` で
 * 新規 `queued` 行を作る (R5.6)。
 */
export const JOB_STATUSES = [
  "queued",
  "researching",
  "structuring",
  "done",
  "failed",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export function isJobStatus(value: unknown): value is JobStatus {
  return (
    typeof value === "string" &&
    (JOB_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * ジョブが in-flight (researching または structuring) かを判定する。
 * `countInFlight` の集計や UI のバッジ判定で使用。
 */
export function isInFlightStatus(value: JobStatus): boolean {
  return value === "researching" || value === "structuring";
}

/**
 * ジョブが進行中 (UI で進行バッジを表示すべき状態) かを判定する。
 * queued も含めるため `isInFlightStatus` とは別関数。
 */
export function isPendingStatus(value: JobStatus): boolean {
  return (
    value === "queued" || value === "researching" || value === "structuring"
  );
}

/**
 * `research_jobs.error_log` jsonb の要素 shape。
 *
 * - `stage`: 失敗が起きたステージ識別。`sweep` は 6h スタック検出由来。
 * - `kind`: 失敗種別の細分類 (例: "stage1_stuck", "stage2_schema_violation",
 *   "stage1_api_error" など)。アプリ層の自由文字列。
 * - `message`: 正規化済みエラーメッセージ (API キー値や request ID は除去済)。
 * - `cancel_result`: sweep 時に `DeepResearchClient.cancelTask` を呼んだ場合に記録。
 */
export interface DeepResearchJobErrorEntry {
  stage: "stage1" | "stage2" | "sweep";
  kind: string;
  message: string;
  occurred_at: string;
  cancel_result?: {
    cancelled: boolean;
    reason?: string;
  };
}

/**
 * `research_jobs` テーブル 1 行に対応するドメイン型。
 *
 * 時刻列は ISO 8601 文字列で表現する (TS 側で `Date` を持ち回ると serialization が
 * 複雑になるため、境界を越える際は常に文字列化する既存規約に合わせる)。
 */
export interface DeepResearchJob {
  id: string;
  store_id: string;
  user_id: string;
  status: JobStatus;
  deep_research_task_id: string | null;
  attempts: number;
  error_log: DeepResearchJobErrorEntry[] | null;
  enqueued_at: string;
  research_started_at: string | null;
  research_completed_at: string | null;
  completed_at: string | null;
}

/**
 * ジョブ新規作成時に Repository に渡すフィールド。
 *
 * `id` / `enqueued_at` / `status` / `attempts` / `error_log` / 全ての時刻列は
 * Repository 側で生成・初期化する。
 */
export interface DeepResearchJobInsert {
  store_id: string;
  user_id: string;
}

/**
 * ジョブ状態遷移用のパッチ。`updateJobStatus` で使用。
 *
 * 時刻列は呼出側 (Action / cron endpoint) で ISO 8601 文字列を組み立てて渡す。
 */
export interface DeepResearchJobStatusPatch {
  status: JobStatus;
  deep_research_task_id?: string | null;
  attempts?: number;
  research_started_at?: string | null;
  research_completed_at?: string | null;
  completed_at?: string | null;
}

/**
 * Deep Research キューページ (`/research`) の一覧 1 行を表す DTO。
 *
 * `lib/db/deep-research-repository.ts` が `stores` / `profiles` を LEFT JOIN して
 * 組み立てる。 join 失敗 (店舗削除済 / placeholder profile) は null で表現する。
 */
export interface DeepResearchQueueRow {
  job: DeepResearchJob;
  /** store.name。 join 失敗時は null (UI 側で "(削除済み)" 表示) */
  store_name: string | null;
  /** profile.display_name。 join 失敗時は null (UI 側で "—" 表示) */
  researcher_display_name: string | null;
}

/**
 * 51 項目の取得難易度区分。design.md §Each Category jsonb 内の項目スキーマ。
 *
 * - A: Web で高信頼に取得可能 (value 必須、source は任意)
 * - B: 推定 (value + confidence + source_urls + source_quote が必須)
 * - C: 店主ヒアリング必須 (value は null 可、hearing_question が必須)
 */
export type DifficultyTier = "A" | "B" | "C";

export interface DeepResearchItem {
  key: string;
  label: string;
  tier: DifficultyTier;
  value: string | null;
  confidence?: number;
  source_urls?: string[];
  source_quote?: string;
  hearing_question?: string;
}

/**
 * 8 カテゴリの jsonb 列に対応するレポート構造。
 * テーブル列名と一致させる: `category_1_basic` 等。
 */
export interface DeepResearchReportCategories {
  category_1_basic: DeepResearchItem[];
  category_2_owner: DeepResearchItem[];
  category_3_menu: DeepResearchItem[];
  category_4_customer: DeepResearchItem[];
  category_5_marketing: DeepResearchItem[];
  category_6_competitor: DeepResearchItem[];
  category_7_owned_media: DeepResearchItem[];
  category_8_other: DeepResearchItem[];
}

export interface HearingQuestion {
  category: string;
  question: string;
}

/**
 * `research_reports` テーブル 1 行に対応するドメイン型。
 */
export interface DeepResearchReport extends DeepResearchReportCategories {
  id: string;
  job_id: string;
  store_id: string;
  hearing_questions: HearingQuestion[];
  full_markdown: string;
  all_source_urls: string[];
  total_cost_yen: string | null;
  total_duration_sec: number;
  created_at: string;
}

/**
 * レポート新規作成時に Repository に渡すフィールド。`id` / `created_at` は生成側で。
 */
export type DeepResearchReportInsert = Omit<
  DeepResearchReport,
  "id" | "created_at"
>;
