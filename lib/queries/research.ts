import "server-only";
import { repos } from "@/lib/repositories";
import { classifyResearchQueue, type ResearchQueueBuckets } from "@/lib/domain/research-review";

export type ResearchQueue = ResearchQueueBuckets;

/**
 * `/research` 一覧の3タブ分を取得する(AI 店舗調査再設計 Plan v3.2 §6, PR5)。
 *
 * `store_research_runs` の「レビュー待ち」判定(succeeded かつ review_completed_at
 * IS NULL のrunが存在するか)は Vercel Workflow のstepから更新されるため、
 * Server Action/Route Handler の外で完結する(`revalidateTag` が確実に効くとは
 * 限らない、beta SDKのため未検証)。このため本クエリは `'use cache'` を使わず、
 * 呼び出しの都度 DB から直接読む(近リアルタイム性を優先、Plan §6)。
 * 下の 3 関数も同じ理由で `'use cache'` を使わない。呼び出し側は Suspense 境界の
 * 内側に置くこと。
 *
 * Issue #110: 旧 `research` テーブルを読む `getResearchByStore` は撤去した。
 * 本ファイルに残るのは AI 店舗調査 (`store_research_runs`) 側のクエリのみ。
 */
export async function getResearchQueue(): Promise<ResearchQueue> {
  const [stores, needsReviewStoreIds] = await Promise.all([
    repos.store.list(),
    repos.researchRun.listStoreIdsNeedingReview(),
  ]);

  return classifyResearchQueue(stores, new Set(needsReviewStoreIds));
}

/**
 * サイドバー「調査」バッジの件数 (#299)。
 *
 * `/research` の「レビュー待ち」タブと**同じ関数の結果の件数**を返す。別の述語で
 * 数え直すと、#299 のように「バッジ 5 / タブ 4」と食い違う。
 */
export async function getResearchReviewCount(): Promise<number> {
  return (await getResearchQueue()).needsReview.length;
}

/** 未レビューの AI 調査結果を持つ店舗の id 集合 (#299, `/stores` の調査段階列用)。 */
export async function getStoreIdsNeedingReview(): Promise<ReadonlySet<string>> {
  return new Set(await repos.researchRun.listStoreIdsNeedingReview());
}

/**
 * 指定店舗に未レビューの AI 調査結果があるか (#299, 店舗詳細用)。
 *
 * 判定の SQL を 1 本に保つため、店舗単位の専用クエリを作らず
 * {@link getStoreIdsNeedingReview} と同じ一覧から引く。
 */
export async function storeNeedsResearchReview(storeId: string): Promise<boolean> {
  return (await getStoreIdsNeedingReview()).has(storeId);
}
