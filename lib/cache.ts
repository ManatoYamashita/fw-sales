/**
 * Cache Components 用のタグキー定数。
 * Server Action 内で `revalidateTag(CACHE_TAGS.stores)` のように使い、
 * RSC 側では `cacheTag(CACHE_TAGS.stores)` で同じキーを指定する。
 */
export const CACHE_TAGS = {
  masters: "masters",
  stats: "stats",
  stores: "stores",
  store: (id: string) => `store:${id}`,
  research: "research",
  researchByStore: (storeId: string) => `research:store:${storeId}`,
  deals: "deals",
  deal: (id: string) => `deal:${id}`,
  dealsByStore: (storeId: string) => `deals:store:${storeId}`,
  handoffs: "handoffs",
  handoff: (id: string) => `handoff:${id}`,
  handoffsByStore: (storeId: string) => `handoffs:store:${storeId}`,
  pipeline: "pipeline",
  kpi: "kpi",
  actionQueue: "action-queue",
} as const;
