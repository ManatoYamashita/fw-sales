/**
 * DeepResearchRepository interface (deep-research-pipeline spec, Issue #43)
 *
 * `research_jobs` と `research_reports` の唯一の書き手契約。
 *
 * 主要な特性:
 * - 並走 cron tick 下での Stage 1 二重起動を防ぐため、`claimOldestQueued` は
 *   行ロック (`SELECT ... FOR UPDATE SKIP LOCKED`) を取得する責務を負う。
 *   DB 実装側 (`lib/db/deep-research-repository.ts`) は Drizzle `sql` template で
 *   ロック取得を実装する。Mock 実装はシングルスレッドの prosecuted-by-await で
 *   擬似的にロックを表現する。
 * - polling 系 (`findOldestResearching`) は Google API 呼出が冪等のためロック不要。
 * - 状態遷移は本リポジトリの API 経由のみとし、無秩序な direct write を禁止する
 *   (`types/deep-research.ts` の `isJobStatus` 型ガードで担保)。
 *
 * 関連: design.md §Components and Interfaces / deepResearchRepository,
 *       requirements.md §1.1, §1.2, §2.3, §5.5, §8.3
 */

import type {
  DeepResearchJob,
  DeepResearchJobInsert,
  DeepResearchJobStatusPatch,
  DeepResearchJobErrorEntry,
  DeepResearchQueueRow,
  DeepResearchReport,
  DeepResearchReportInsert,
} from "@/types/deep-research";

export interface DeepResearchRepository {
  /**
   * 対象店舗に対し進行中ジョブ (`queued` / `researching` / `structuring`) が
   * 存在すれば返す。重複登録の検出に使用 (R1.2)。
   */
  findActiveByStore(storeId: string): Promise<DeepResearchJob | null>;

  /**
   * 最古の `queued` ジョブを行ロック (`FOR UPDATE SKIP LOCKED`) で 1 件取得する。
   * 並走 cron tick が同一ジョブを二重に Stage 1 起動するのを防ぐ。
   * 対象が無ければ null。
   */
  claimOldestQueued(): Promise<DeepResearchJob | null>;

  /**
   * 最古の `researching` ジョブを最大 `limit` 件まで返す。
   * polling 用。API 呼出が冪等なためロックは取らない。
   */
  findOldestResearching(limit: number): Promise<DeepResearchJob[]>;

  /**
   * 同時 in-flight (researching + structuring) のジョブ件数を返す。
   * Stage 1 新規起動可否の判定に使用 (`DEEP_RESEARCH_MAX_IN_FLIGHT` との比較)。
   */
  countInFlight(): Promise<number>;

  /**
   * pending (queued + researching + structuring) 全件数。
   * サイドバーバッジ表示に使用。 `countInFlight()` と異なり `queued` を含む。
   */
  countPending(): Promise<number>;

  /**
   * Deep Research キューページ (`/research`) の「実行中」タブ用。
   * `queued` / `researching` / `structuring` の全件を `enqueued_at ASC` で返す。
   * `stores` / `profiles` を LEFT JOIN して `DeepResearchQueueRow` を返却する。
   * 暴走防止のためハードキャップ 200 件。
   */
  listInFlight(): Promise<DeepResearchQueueRow[]>;

  /**
   * 「完了」タブ用。 `done` の直近 `limit` 件を `completed_at DESC` で返す。
   * `limit` は 1..100 にクランプする。
   */
  listRecentDone(limit: number): Promise<DeepResearchQueueRow[]>;

  /**
   * 「失敗」タブ用。 `failed` の直近 `limit` 件を `completed_at DESC` で返す。
   * `limit` は 1..100 にクランプする。
   */
  listRecentFailed(limit: number): Promise<DeepResearchQueueRow[]>;

  /**
   * `researching` または `structuring` 状態のまま閾値時刻より古いジョブを返す。
   * 6h スタック検出 sweep で使用 (R5.4)。
   */
  findStuckJobs(thresholdAt: Date): Promise<DeepResearchJob[]>;

  getById(jobId: string): Promise<DeepResearchJob | null>;

  /** ID で 1 件取得 (stores + profiles LEFT JOIN 済み DTO)。 詳細ページ用。 */
  getByIdWithDetails(jobId: string): Promise<DeepResearchQueueRow | null>;

  /** 対象店舗の最新レポート (`created_at` DESC 1 件) を返す。 */
  getReportByStore(storeId: string): Promise<DeepResearchReport | null>;

  /** ユーザー単位の日次登録件数。`sinceUTC` 以降の `enqueued_at` を集計。 */
  countByUserSinceDay(userId: string, sinceUTC: Date): Promise<number>;

  /** 月次集計。`yearMonthJST` は `"YYYY-MM"` 形式の JST 月 (例 `"2026-05"`)。 */
  countByMonth(yearMonthJST: string): Promise<number>;

  /** 新規ジョブを `queued` 状態で挿入する。`id` / `enqueued_at` 等は実装側で生成。 */
  insertJob(input: DeepResearchJobInsert): Promise<DeepResearchJob>;

  /**
   * ジョブの状態と関連時刻列を更新する。
   * 遷移許容ペアの検査は呼出側で行うこと (本メソッドは単なる write)。
   */
  updateJobStatus(
    jobId: string,
    patch: DeepResearchJobStatusPatch,
  ): Promise<DeepResearchJob>;

  /** `error_log` jsonb に 1 エントリ append する。 */
  appendJobError(
    jobId: string,
    error: DeepResearchJobErrorEntry,
  ): Promise<DeepResearchJob>;

  /** failed ジョブを物理削除する。failed 以外の status では何もしない。 */
  deleteJob(jobId: string): Promise<boolean>;

  /** 任意ステータスのジョブを論理削除する。 */
  softDeleteJob(jobId: string, userId: string): Promise<boolean>;

  /** 指定ID群を一括で論理削除し、削除件数を返す。 */
  softDeleteJobs(jobIds: string[], userId: string): Promise<number>;

  /** Stage 2 構造化完了後にレポートを挿入する。`id` / `created_at` は実装側で生成。 */
  insertReport(input: DeepResearchReportInsert): Promise<DeepResearchReport>;

  /** 完了済みレポートの平均所要時間 (秒)。データ 0 件なら null。 */
  getAverageDurationSec(): Promise<number | null>;

  /** 全ジョブを `enqueued_at DESC` で最大 `limit` 件返す。status フィルタなし。 */
  listAll(limit: number): Promise<DeepResearchQueueRow[]>;

  /** pending ジョブが存在する store_id の一覧。状態表示の自動判定に使用。 */
  listActiveStoreIds(): Promise<string[]>;
}
