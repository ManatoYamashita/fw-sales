/**
 * profiles 取得クエリ (auth-and-notifications spec, Issue #16)
 *
 * Server Component / Server Action から呼ばれる `'use cache'` 関数群。
 * `CACHE_TAGS.profiles` / `CACHE_TAGS.profile(id)` でタグ付けし、
 * Server Action 後の `revalidateTag` で stale-while-revalidate を発火する。
 *
 * 関連: design.md §「lib/queries/profiles.ts」, requirements.md §1.5, §3.7
 */

import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { repos } from "@/lib/repositories";
import { CACHE_TAGS } from "@/lib/cache";
import type { Member, Profile } from "@/types/profile";

/**
 * テナント所属者のプロフィール取得 (担当者選択 UI・担当者名の表示用)。
 *
 * 同じ tenantId の呼び出し元同士でキャッシュを共有する。
 */
export async function getAllProfiles(tenantId: string): Promise<readonly Profile[]> {
  "use cache";
  cacheLife("longBackstop");
  cacheTag(CACHE_TAGS.profiles(tenantId));
  return repos.forTenant(tenantId).membership.list();
}

/**
 * テナントの所属者を、そのテナントでのロール付きで取得する (ユーザー管理 UI 用)。
 *
 * `tenantId` は `resolveTenantId()` で解決した値を渡す。引数はキャッシュキーに含まれる。
 * ロールの変更は `CACHE_TAGS.profiles` の失効で反映される。
 *
 * @param options.excludePlaceholders true なら placeholder の所属を除く
 */
export async function getTenantMembers(
  tenantId: string,
  options?: { readonly excludePlaceholders?: boolean },
): Promise<readonly Member[]> {
  "use cache";
  cacheLife("longBackstop");
  cacheTag(CACHE_TAGS.profiles(tenantId));
  return repos.forTenant(tenantId).membership.list(options);
}

/**
 * id でプロフィールを取得。
 * 個別 profile 単位の cache タグ (`profile:${id}`) で stale-while-revalidate する。
 */
export async function getProfileById(tenantId: string, id: string): Promise<Profile | null> {
  "use cache";
  cacheLife("longBackstop");
  cacheTag(CACHE_TAGS.profile(tenantId, id));
  return repos.forTenant(tenantId).membership.find(id);
}

/**
 * 複数 id でプロフィールを一括取得 (リマインダー / 担当者表示の N+1 回避用)。
 * 集合 cache タグ (`profiles`) で revalidate する。
 */
export async function getProfilesByIds(
  tenantId: string,
  ids: readonly string[],
): Promise<readonly Profile[]> {
  "use cache";
  cacheLife("longBackstop");
  cacheTag(CACHE_TAGS.profiles(tenantId));
  const wanted = new Set(ids);
  return (await repos.forTenant(tenantId).membership.list()).filter((profile) => wanted.has(profile.id));
}
