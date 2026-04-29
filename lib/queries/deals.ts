import "server-only";
import { cacheTag } from "next/cache";
import { repos } from "@/lib/repositories";
import { CACHE_TAGS } from "@/lib/cache";
import type { Deal } from "@/types/deal";

export async function listDealsCached(): Promise<Deal[]> {
  "use cache";
  cacheTag(CACHE_TAGS.deals);
  return repos.deal.list();
}

export async function getDealCached(id: string): Promise<Deal | null> {
  "use cache";
  cacheTag(CACHE_TAGS.deal(id), CACHE_TAGS.deals);
  return repos.deal.get(id);
}
