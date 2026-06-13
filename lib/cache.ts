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
  // auth-and-notifications spec (Issue #16)
  profiles: "profiles",
  profile: (id: string) => `profile:${id}`,
  notifications: "notifications",
  notification: (id: string) => `notification:${id}`,
  // task 4.2 (PR3a): deepResearchByStore / deepResearchJob / deepResearchQueue を撤去
  // (#121 / #110 連動)。
  // AI プロンプトテンプレート (Issue #42)
  promptTemplates: "prompt-templates",
  // アプリ全体設定 key-value (store-flow-guidance / Issue #122)
  appSettings: "app-settings",
} as const;
