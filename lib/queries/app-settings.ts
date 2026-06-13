/**
 * アプリ全体設定の cached query (store-flow-guidance / Issue #122)
 *
 * 現状は調査用 Gem の URL のみ。`prompt-templates.ts` に倣い `'use cache'` +
 * `cacheTag(CACHE_TAGS.appSettings)` で読み取り、`setGemUrlAction` 側の
 * `updateTag(CACHE_TAGS.appSettings)` で無効化される。
 */

import "server-only";

import { cacheLife, cacheTag } from "next/cache";
import { repos } from "@/lib/repositories";
import { CACHE_TAGS } from "@/lib/cache";

/** 調査用 Gem の URL を保持する app_settings のキー。 */
export const DEEP_RESEARCH_GEM_URL_KEY = "deep_research_gem_url";

/** 調査用 Gem の URL を取得する。未設定 / 空文字なら null。 */
export async function getGemUrlCached(): Promise<string | null> {
  "use cache";
  cacheLife("longBackstop");
  cacheTag(CACHE_TAGS.appSettings);
  const value = await repos.appSettings.get(DEEP_RESEARCH_GEM_URL_KEY);
  return value && value.trim() !== "" ? value : null;
}
