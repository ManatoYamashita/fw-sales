import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { repos } from "@/lib/repositories";
import { CACHE_TAGS } from "@/lib/cache";
import { omitContactEmail } from "@/lib/domain/store-contact-email";
import {
  DEFAULT_STORE_SORT,
  type Store,
  type StoreFilter,
  type StoreSort,
} from "@/types/store";
import type { StageId } from "@/types/stage";
import {
  applyStoreFilter,
  applyStoreSort,
  type StoreSortContext,
} from "./store-sort";

// pure な filter/sort はサーバ外でも使えるよう再エクスポート
export { applyStoreFilter, applyStoreSort };
export type { StoreSortContext };

async function listAllStoresCached() {
  "use cache";
  cacheLife("longBackstop");
  cacheTag(CACHE_TAGS.stores);
  // 一覧系の画面は契約連絡先メールを表示しないため、ブラウザへ渡す前に外す (#384)。
  // エクスポートは repos.store.list() を直接読むため、アドレスを含んだまま書き出す。
  return (await repos.store.list()).map(omitContactEmail);
}

export async function listStores(
  filter: StoreFilter = {},
  sort: StoreSort = DEFAULT_STORE_SORT,
  ctx: StoreSortContext = {},
): Promise<Store[]> {
  const all = await listAllStoresCached();
  return applyStoreSort(applyStoreFilter(all, filter), sort, ctx);
}

export async function getStoreCached(id: string): Promise<Store | null> {
  "use cache";
  cacheLife("longBackstop");
  cacheTag(CACHE_TAGS.store(id), CACHE_TAGS.stores);
  return repos.store.get(id);
}

export interface StoreCounts {
  total: number;
  byStage: Record<StageId, number>;
}
