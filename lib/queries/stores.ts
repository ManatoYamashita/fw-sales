import "server-only";
import { cacheTag } from "next/cache";
import { repos } from "@/lib/repositories";
import { CACHE_TAGS } from "@/lib/cache";
import {
  DEFAULT_STORE_SORT,
  type Priority,
  type Store,
  type StoreFilter,
  type StoreSort,
} from "@/types/store";
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

const PRIORITY_RANK: Record<Priority, number> = { 高: 3, 中: 2, 低: 1 };

export function applyStoreSort(
  stores: readonly Store[],
  sort: StoreSort = DEFAULT_STORE_SORT,
): Store[] {
  const sign = sort.dir === "asc" ? 1 : -1;
  const rows = [...stores];
  rows.sort((a, b) => {
    let diff = 0;
    switch (sort.key) {
      case "name":
        diff = a.name.localeCompare(b.name, "ja");
        break;
      case "review_avg":
        diff = (a.review_avg ?? 0) - (b.review_avg ?? 0);
        break;
      case "review_count":
        diff = (a.review_count ?? 0) - (b.review_count ?? 0);
        break;
      case "priority":
        diff = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
        break;
      case "updated":
      default:
        diff = a.updated_at.localeCompare(b.updated_at);
        break;
    }
    if (diff !== 0) return diff * sign;
    // 安定化: 同点は更新日新しい順 → 名前
    const u = b.updated_at.localeCompare(a.updated_at);
    if (u !== 0) return u;
    return a.name.localeCompare(b.name, "ja");
  });
  return rows;
}

export async function listStores(
  filter: StoreFilter = {},
  sort: StoreSort = DEFAULT_STORE_SORT,
): Promise<Store[]> {
  const all = await listAllStoresCached();
  return applyStoreSort(applyStoreFilter(all, filter), sort);
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
