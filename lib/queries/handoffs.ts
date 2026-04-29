import "server-only";
import { cacheTag } from "next/cache";
import { repos } from "@/lib/repositories";
import { CACHE_TAGS } from "@/lib/cache";
import type { Handoff } from "@/types/handoff";

export async function listHandoffsCached(): Promise<Handoff[]> {
  "use cache";
  cacheTag(CACHE_TAGS.handoffs);
  return repos.handoff.list();
}

export async function getHandoffCached(id: string): Promise<Handoff | null> {
  "use cache";
  cacheTag(CACHE_TAGS.handoff(id), CACHE_TAGS.handoffs);
  return repos.handoff.get(id);
}
