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
  "use cache";
  cacheTag(CACHE_TAGS.deepResearchByStore(storeId));

  const session = await getCurrentSession();
  if (!session) return null;

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
