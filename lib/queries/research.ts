import "server-only";
import { repos } from "@/lib/repositories";
import { classifyResearchQueue, type ResearchQueueBuckets } from "@/lib/domain/research-review";

export type ResearchQueue = ResearchQueueBuckets;

/**
 * `/research` 一覧の3タブ分を取得する(AI 店舗調査再設計 Plan v3.2 §6, PR5)。
 *
 * `store_research_runs` の「要確認」判定(succeeded かつ review_completed_at
 * IS NULL のrunが存在するか)は Vercel Workflow のstepから更新されるため、
 * Server Action/Route Handler の外で完結する(`revalidateTag` が確実に効くとは
 * 限らない、beta SDKのため未検証)。このため本クエリは `'use cache'` を使わず、
 * 呼び出しの都度 DB から直接読む(近リアルタイム性を優先、Plan §6)。
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
