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
import { cacheTag } from "next/cache";
import { repos } from "@/lib/repositories";
import { CACHE_TAGS } from "@/lib/cache";
import type { Profile } from "@/types/profile";

/**
 * 全プロフィール取得 (担当者選択 UI 用)。
 *
 * @param options.excludePlaceholders true の場合は `role: 'placeholder'` を除外。
 *        担当者選択肢として実ユーザーのみを表示したい場合に使用。
 */
export async function getAllProfiles(options?: {
  readonly excludePlaceholders?: boolean;
}): Promise<readonly Profile[]> {
  "use cache";
  cacheTag(CACHE_TAGS.profiles);
  return repos.profile.findAll(options);
}

/**
 * id でプロフィールを取得。
 * 個別 profile 単位の cache タグ (`profile:${id}`) で stale-while-revalidate する。
 */
export async function getProfileById(id: string): Promise<Profile | null> {
  "use cache";
  cacheTag(CACHE_TAGS.profile(id));
  return repos.profile.findById(id);
}

/**
 * 複数 id でプロフィールを一括取得 (リマインダー / 担当者表示の N+1 回避用)。
 * 集合 cache タグ (`profiles`) で revalidate する。
 */
export async function getProfilesByIds(
  ids: readonly string[],
): Promise<readonly Profile[]> {
  "use cache";
  cacheTag(CACHE_TAGS.profiles);
  return repos.profile.findManyByIds(ids);
}
