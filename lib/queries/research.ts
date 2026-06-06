import "server-only";
import { cacheTag } from "next/cache";
import { repos } from "@/lib/repositories";
import { CACHE_TAGS } from "@/lib/cache";
import type { Store } from "@/types/store";
import type { Research } from "@/types/research";

export interface ResearchQueue {
  /** 調査待ち: 未調査の店舗。 */
  waiting: Store[];
  /** 調査済み: DeepResearch 済み / 架電済みの店舗。 */
  done: Store[];
}

export async function getResearchQueue(): Promise<ResearchQueue> {
  "use cache";
  // 手動貼付フローでは done は stage で判定する(旧 research テーブル非依存)。
  // 店舗の stage が変われば CACHE_TAGS.stores の revalidate で本クエリも失効する。
  cacheTag(CACHE_TAGS.stores);
  const stores = await repos.store.list();

  return {
    waiting: stores.filter((s) => s.stage === "未調査"),
    done: stores.filter(
      (s) => s.stage === "DeepResearch済み" || s.stage === "架電済み",
    ),
  };
}

export async function getResearchByStore(
  storeId: string,
): Promise<Research | null> {
  "use cache";
  cacheTag(CACHE_TAGS.researchByStore(storeId), CACHE_TAGS.research);
  return repos.research.getByStoreId(storeId);
}
