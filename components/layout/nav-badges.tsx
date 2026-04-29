import { cacheTag } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache";
import { getNavBadgeCounts, type NavBadgeCounts } from "@/lib/queries/stats";

/**
 * RSC: サイドバーに表示するバッジ件数を取得する。
 * `'use cache'` + 関連エンティティの tag を付与し、Server Action 側で
 * revalidateTag が走るとサイドバーも更新される。
 */
export async function loadNavBadgeCounts(): Promise<NavBadgeCounts> {
  "use cache";
  cacheTag(CACHE_TAGS.stores, CACHE_TAGS.deals, CACHE_TAGS.handoffs);
  return getNavBadgeCounts();
}
