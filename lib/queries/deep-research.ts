/**
 * Deep Research 関連の `'use cache'` クエリ (deep-research-pipeline spec, Issue #43, Task 3.2)
 *
 * - `getDeepResearchReport(storeId)`: 店舗の最新レポートを返す
 * - `getDeepResearchJobByStore(storeId)`: 店舗の進行中ジョブを返す (進行中以外は null)
 *
 * Cache タグ: `CACHE_TAGS.deepResearchByStore(storeId)` を付与。Action 層の
 * `enqueueDeepResearchAction` / `retryDeepResearchAction` が同じタグで revalidate する。
 *
 * 認可: レポート取得時のみ `getCurrentSession()` でログインユーザー検証。
 * 店舗単位の閲覧権限制御は将来拡張余地として残し、現状はログインのみ必須とする
 * (既存 stores テーブルがチーム共有前提で運用されているため)。
 *
 * 関連: design.md §Components and Interfaces / getDeepResearchReport +
 *       getDeepResearchJobByStore, requirements.md §5.2, §7.5
 */

import "server-only";

import { cacheTag } from "next/cache";
import { repos } from "@/lib/repositories";
import { CACHE_TAGS } from "@/lib/cache";
import { getCurrentSession } from "@/lib/supabase/server";
import type {
  DeepResearchJob,
  DeepResearchQueueRow,
  DeepResearchReport,
} from "@/types/deep-research";

/**
 * 店舗の最新 Deep Research レポートを返す (created_at DESC 1 件)。
 *
 * - 未認証ユーザー: `null`
 * - レポート未生成: `null`
 */
export async function getDeepResearchReport(
  storeId: string,
): Promise<DeepResearchReport | null> {
  const session = await getCurrentSession();
  if (!session) return null;

  return getDeepResearchReportCached(storeId);
}

async function getDeepResearchReportCached(
  storeId: string,
): Promise<DeepResearchReport | null> {
  "use cache";
  cacheTag(CACHE_TAGS.deepResearchByStore(storeId));

  return repos.deepResearch.getReportByStore(storeId);
}

/**
 * 店舗の進行中ジョブを返す (queued / researching / structuring のいずれか)。
 * done / failed は返さず null。UI の進行中バッジ表示・CTA disable 判定に使う。
 */
export async function getDeepResearchJobByStore(
  storeId: string,
): Promise<DeepResearchJob | null> {
  "use cache";
  cacheTag(CACHE_TAGS.deepResearchByStore(storeId));

  return repos.deepResearch.findActiveByStore(storeId);
}

/**
 * 店舗に紐づく最新ジョブ (`enqueued_at` DESC)。進行中・完了・失敗を問わず 1 件。
 * 店舗詳細の Deep Research 欄から `/research/jobs/[id]` へ誘導する際に使用。
 */
export async function getLatestDeepResearchJobByStore(
  storeId: string,
): Promise<DeepResearchJob | null> {
  "use cache";
  cacheTag(CACHE_TAGS.deepResearchByStore(storeId));

  return repos.deepResearch.findLatestByStore(storeId);
}

/**
 * 調査キューページ用: in-flight (queued / researching / structuring) の全ジョブ。
 *
 * - スコープ: チーム全員横断 (担当者列に display_name を表示するため LEFT JOIN 済)
 * - 並び順: 最古優先 (`enqueued_at ASC`)
 * - キャッシュタグ: `CACHE_TAGS.deepResearchQueue` で enqueue / status 遷移 / retry /
 *   sweep の各所から revalidate される
 */
export async function listInFlightDeepResearchJobs(): Promise<
  DeepResearchQueueRow[]
> {
  "use cache";
  cacheTag(CACHE_TAGS.deepResearchQueue);

  return repos.deepResearch.listInFlight();
}

/**
 * 調査キューページ用: 完了 (`done`) の最新 `limit` 件。
 * デフォルト 30 件、 ハードキャップ 100 件 (repository 層でクランプ)。
 */
export async function listRecentDoneDeepResearchJobs(
  limit = 30,
): Promise<DeepResearchQueueRow[]> {
  "use cache";
  cacheTag(CACHE_TAGS.deepResearchQueue);

  return repos.deepResearch.listRecentDone(limit);
}

/**
 * 調査キューページ用: 失敗 (`failed`) の最新 `limit` 件。
 */
export async function listRecentFailedDeepResearchJobs(
  limit = 30,
): Promise<DeepResearchQueueRow[]> {
  "use cache";
  cacheTag(CACHE_TAGS.deepResearchQueue);

  return repos.deepResearch.listRecentFailed(limit);
}

/**
 * ジョブ ID で 1 件取得 (詳細ページ用)。 店舗名・担当者名も JOIN。
 */
export async function getDeepResearchJobById(
  jobId: string,
): Promise<DeepResearchQueueRow | null> {
  "use cache";
  cacheTag(CACHE_TAGS.deepResearchJob(jobId));
  cacheTag(CACHE_TAGS.stores);
  cacheTag(CACHE_TAGS.profiles);

  return repos.deepResearch.getByIdWithDetails(jobId);
}

/**
 * 完了済み Deep Research レポートの平均所要時間 (秒)。
 *
 * null = 完了データなし (初回利用時)。 UI 側で「通常 30分〜2時間」のデフォルト文言を表示。
 */
export async function getAverageResearchDuration(): Promise<number | null> {
  "use cache";
  cacheTag(CACHE_TAGS.deepResearchQueue);

  return repos.deepResearch.getAverageDurationSec();
}

/**
 * 調査キューページ用: 全ジョブを `enqueued_at DESC` で返す。
 */
export async function listAllDeepResearchJobs(): Promise<
  DeepResearchQueueRow[]
> {
  "use cache";
  cacheTag(CACHE_TAGS.deepResearchQueue);

  return repos.deepResearch.listAll(200);
}

/**
 * pending ジョブが存在する store_id の Set。
 * 店舗一覧で「DeepResearching...」表示状態を計算するために使用。
 */
export async function listActiveDeepResearchStoreIds(): Promise<Set<string>> {
  "use cache";
  cacheTag(CACHE_TAGS.deepResearchQueue);

  const ids = await repos.deepResearch.listActiveStoreIds();
  return new Set(ids);
}
