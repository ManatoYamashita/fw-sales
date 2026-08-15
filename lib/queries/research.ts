import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { repos } from "@/lib/repositories";
import { CACHE_TAGS } from "@/lib/cache";
import { classifyResearchQueue, type ResearchQueueBuckets } from "@/lib/domain/research-review";
import type { Research } from "@/types/research";

export type ResearchQueue = ResearchQueueBuckets;

/**
 * `/research` 一覧の3タブ分を取得する(AI 店舗調査再設計 Plan v3.2 §6, PR5)。
 *
 * `store_research_runs` の「要確認」判定(succeeded かつ review_completed_at
 * IS NULL のrunが存在するか)は Vercel Workflow のstepから更新されるため、
 * Server Action/Route Handler の外で完結する(`revalidateTag` が確実に効くとは
 * 限らない、beta SDKのため未検証)。このため本クエリは `'use cache'` を使わず、
 * 呼び出しの都度 DB から直接読む(近リアルタイム性を優先、Plan §6)。
 */
export async function getResearchQueue(): Promise<ResearchQueue> {
  const [stores, needsReviewStoreIds] = await Promise.all([
    repos.store.list(),
    repos.researchRun.listStoreIdsNeedingReview(),
  ]);

  return classifyResearchQueue(stores, new Set(needsReviewStoreIds));
}

export async function getResearchByStore(
  storeId: string,
): Promise<Research | null> {
  "use cache";
  cacheLife("longBackstop");
  cacheTag(CACHE_TAGS.researchByStore(storeId), CACHE_TAGS.research);
  return repos.research.getByStoreId(storeId);
}
