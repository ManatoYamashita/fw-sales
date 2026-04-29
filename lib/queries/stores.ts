import "server-only";
import { cacheTag } from "next/cache";
import { repos } from "@/lib/repositories";
import { CACHE_TAGS } from "@/lib/cache";
import type { Store, StoreFilter } from "@/types/store";
import type { StageId } from "@/types/stage";

async function listAllStoresCached() {
  "use cache";
  cacheTag(CACHE_TAGS.stores);
  return repos.store.list();
}

export function applyStoreFilter(
  stores: readonly Store[],
  filter: StoreFilter,
): Store[] {
  const q = filter.q?.trim().toLowerCase();
  return stores.filter((s) => {
    if (filter.stage && s.stage !== filter.stage) return false;
    if (filter.priority && s.priority !== filter.priority) return false;
    if (filter.channel && s.channel !== filter.channel) return false;
    if (q) {
      const haystack = [
        s.name,
        s.city,
        s.prefecture,
        s.address,
        s.genre,
        s.memo,
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

export async function listStores(filter: StoreFilter = {}): Promise<Store[]> {
  const all = await listAllStoresCached();
  return applyStoreFilter(all, filter);
}

export async function getStoreCached(id: string): Promise<Store | null> {
  "use cache";
  cacheTag(CACHE_TAGS.store(id), CACHE_TAGS.stores);
  return repos.store.get(id);
}

export interface StoreCounts {
  total: number;
  byStage: Record<StageId, number>;
}
