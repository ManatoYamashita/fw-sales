import { cacheLife, cacheTag } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache";
import {
  getCacheableNavBadgeCounts,
  getResearchNavBadgeCount,
  type CacheableNavBadgeCounts,
  type NavBadgeCounts,
} from "@/lib/queries/stats";
import { resolveTenantId } from "@/lib/tenant/context";

async function loadCacheableNavBadgeCounts(tenantId: string): Promise<CacheableNavBadgeCounts> {
  "use cache";
  cacheLife("longBackstop");
  cacheTag(CACHE_TAGS.stores(tenantId), CACHE_TAGS.deals(tenantId), CACHE_TAGS.handoffs(tenantId));
  return getCacheableNavBadgeCounts(tenantId);
}

/**
 * RSC: サイドバーに表示するバッジ件数を取得する。
 *
 * research 以外は `'use cache'` + 関連エンティティの tag を付与し、Server Action 側で
 * revalidateTag が走るとサイドバーも更新される。research (レビュー待ち件数) だけは
 * Workflow の step が更新するためキャッシュせず、都度読む (#299)。
 * 呼び出し元の `SidebarShell` は cookies() を読む動的な Suspense 配下にある。
 */
export async function loadNavBadgeCounts(): Promise<NavBadgeCounts> {
  const tenantId = await resolveTenantId();
  const [cacheable, research] = await Promise.all([
    loadCacheableNavBadgeCounts(tenantId),
    getResearchNavBadgeCount(tenantId),
  ]);
  return { ...cacheable, research };
}
