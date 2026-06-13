"use server";

/**
 * アプリ全体設定 Server Actions (store-flow-guidance / Issue #122)
 *
 * 現状は調査用 Gem の URL の保存のみ。`prompt-template-actions.ts` の定型
 * (getCurrentSession 認証 → zod 検証 → repo → updateTag) を流用する。
 *
 * 関連: Issue #122, lib/queries/app-settings.ts, lib/db/app-settings-repository.ts
 */

import "server-only";

import { z } from "zod";
import { updateTag } from "next/cache";
import { repos } from "@/lib/repositories";
import { CACHE_TAGS } from "@/lib/cache";
import { getCurrentSession } from "@/lib/supabase/server";
import { DEEP_RESEARCH_GEM_URL_KEY } from "@/lib/queries/app-settings";
import { failure, readString, success, type ActionResult } from "./_helpers";

const gemUrlSchema = z
  .string()
  .trim()
  .url("URL の形式が正しくありません")
  .refine(
    (u) => /^https?:\/\//i.test(u),
    "http(s) で始まる URL を入力してください",
  );

/**
 * 調査用 Gem の URL を保存する。空入力はクリア (空文字保存) として扱う。
 */
export async function setGemUrlAction(
  formData: FormData,
): Promise<ActionResult> {
  const session = await getCurrentSession();
  if (!session) return failure("ログインが必要です");

  const raw = readString(formData, "gem_url");

  if (raw === "") {
    await repos.appSettings.set(DEEP_RESEARCH_GEM_URL_KEY, "");
    updateTag(CACHE_TAGS.appSettings);
    return success(undefined, "Gem URL をクリアしました");
  }

  const parsed = gemUrlSchema.safeParse(raw);
  if (!parsed.success) {
    return failure(parsed.error.issues[0]?.message ?? "URL が不正です");
  }

  await repos.appSettings.set(DEEP_RESEARCH_GEM_URL_KEY, parsed.data);
  updateTag(CACHE_TAGS.appSettings);
  return success(undefined, "Gem URL を保存しました");
}
