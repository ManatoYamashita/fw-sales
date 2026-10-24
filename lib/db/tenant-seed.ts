import { SEED_STORES, SEED_DEALS, SEED_HANDOFFS } from "./seed-data";
import { FIRSTWEB_TENANT_ID } from "@/lib/tenant/id";
import type { DbSnapshot } from "./snapshot";

/** Firstwebは既存の固定IDを維持。他社はUUIDのnamespaceで親子IDを一緒に変換する。 */
export function createTenantSeed(tenantId: string): DbSnapshot {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId)) throw new Error("テナントIDが不正です");
  const canonicalId = tenantId.toLowerCase();
  const id = (value: string) => canonicalId === FIRSTWEB_TENANT_ID ? value : `${value}_tenant_${canonicalId.replaceAll("-", "")}`;
  return {
    stores: SEED_STORES.map(store => ({ ...store, id: id(store.id) })),
    deals: SEED_DEALS.map(deal => ({ ...deal, id: id(deal.id), store_id: id(deal.store_id) })),
    handoffs: SEED_HANDOFFS.map(handoff => ({ ...handoff, id: id(handoff.id), store_id: id(handoff.store_id), deal_id: id(handoff.deal_id) })),
  };
}
