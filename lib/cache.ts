/**
 * Cache Components 用のテナント付きタグの生成関数。
 * Server Action 内で `revalidateTag(CACHE_TAGS.stores(tenantId), "max")` のように使い、
 * RSC 側では `cacheTag(CACHE_TAGS.stores(tenantId))` で同じキーを指定する。
 */
export const CACHE_TAGS = {
  masters: (tenantId: string) => `tenant:${tenantId}:masters`,
  stats: (tenantId: string) => `tenant:${tenantId}:stats`,
  stores: (tenantId: string) => `tenant:${tenantId}:stores`,
  store: (tenantId: string, id: string) => `tenant:${tenantId}:store:${id}`,
  deals: (tenantId: string) => `tenant:${tenantId}:deals`,
  deal: (tenantId: string, id: string) => `tenant:${tenantId}:deal:${id}`,
  dealsByStore: (tenantId: string, storeId: string) => `tenant:${tenantId}:deals:store:${storeId}`,
  handoffs: (tenantId: string) => `tenant:${tenantId}:handoffs`,
  handoff: (tenantId: string, id: string) => `tenant:${tenantId}:handoff:${id}`,
  handoffsByStore: (tenantId: string, storeId: string) => `tenant:${tenantId}:handoffs:store:${storeId}`,
  pipeline: (tenantId: string) => `tenant:${tenantId}:pipeline`,
  kpi: (tenantId: string) => `tenant:${tenantId}:kpi`,
  actionQueue: (tenantId: string) => `tenant:${tenantId}:action-queue`,
  // auth-and-notifications spec (Issue #16)
  profiles: (tenantId: string) => `tenant:${tenantId}:profiles`,
  profile: (tenantId: string, id: string) => `tenant:${tenantId}:profile:${id}`,
  notifications: (tenantId: string) => `tenant:${tenantId}:notifications`,
  notification: (tenantId: string, id: string) => `tenant:${tenantId}:notification:${id}`,
  // task 4.2 (PR3a): deepResearchByStore / deepResearchJob / deepResearchQueue を撤去
  // (#121 / #110 連動)。
  // Issue #110: 旧手入力調査テーブルの research / researchByStore も撤去。
  // AI 店舗調査 (`store_research_runs`) の失効は stores / store(id) タグに相乗りする。
  // AI プロンプトテンプレート (Issue #42)
  promptTemplates: (tenantId: string) => `tenant:${tenantId}:prompt-templates`,
  // アプリ全体設定 key-value (store-flow-guidance / Issue #122)
  appSettings: (tenantId: string) => `tenant:${tenantId}:app-settings`,
} as const;
