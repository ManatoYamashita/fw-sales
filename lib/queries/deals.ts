import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { repos } from "@/lib/repositories";
import { CACHE_TAGS } from "@/lib/cache";
import type { Deal } from "@/types/deal";

export async function listDealsCached(tenantId: string): Promise<Deal[]> {
  "use cache";
  cacheLife("longBackstop");
  cacheTag(CACHE_TAGS.deals(tenantId));
  return repos.deal.list();
}

export async function getDealCached(tenantId: string, id: string): Promise<Deal | null> {
  "use cache";
  cacheLife("longBackstop");
  cacheTag(CACHE_TAGS.deal(tenantId, id), CACHE_TAGS.deals(tenantId));
  return repos.deal.get(id);
}

export async function listDealsByStoreCached(tenantId: string, storeId: string): Promise<Deal[]> {
  "use cache";
  cacheLife("longBackstop");
  cacheTag(CACHE_TAGS.dealsByStore(tenantId, storeId), CACHE_TAGS.deals(tenantId));
  return repos.deal.list(storeId);
}
