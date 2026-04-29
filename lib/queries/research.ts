import "server-only";
import { cacheTag } from "next/cache";
import { repos } from "@/lib/repositories";
import { CACHE_TAGS } from "@/lib/cache";
import type { Store } from "@/types/store";
import type { Research } from "@/types/research";

export interface ResearchQueue {
  waiting: Store[];
  done: Array<{ store: Store; research: Research }>;
}

export async function getResearchQueue(): Promise<ResearchQueue> {
  "use cache";
  cacheTag(CACHE_TAGS.stores, CACHE_TAGS.research);
  const [stores, research] = await Promise.all([
    repos.store.list(),
    repos.research.list(),
  ]);
  const researchByStore = new Map(research.map((r) => [r.store_id, r]));

  return {
    waiting: stores.filter((s) => s.stage === "調査待ち"),
    done: stores
      .filter((s) => researchByStore.has(s.id))
      .map((s) => ({ store: s, research: researchByStore.get(s.id)! })),
  };
}

export async function getResearchByStore(
  storeId: string,
): Promise<Research | null> {
  "use cache";
  cacheTag(CACHE_TAGS.researchByStore(storeId), CACHE_TAGS.research);
  return repos.research.getByStoreId(storeId);
}
