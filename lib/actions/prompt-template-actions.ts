"use server";

/**
 * AI プロンプトテンプレート Server Actions (Issue #42 Phase 2)
 *
 * CRUD + setDefault の 5 アクションを提供する。
 *
 * 設計上のポイント:
 * - `getCurrentSession()` でログインユーザーを取得し、未ログインは即 failure
 * - `is_default` はクライアント入力を信用しない (insert は count===0 のみ true)
 * - `update` は name / body のみ変更する (is_default は setDefault 経由)
 * - `setDefault` は repos.transaction() で原子性を保証 (clearDefault → set の 2 ステップ)
 * - デフォルトテンプレートの削除は Server Action 側でも事前に拒否する (DB trigger の二重ガード)
 *
 * 関連: Issue #42, lib/db/prompt-template-repository.ts,
 *       lib/repositories/prompt-template-repository.ts
 */

import "server-only";

import { z } from "zod";
import { revalidateTag } from "next/cache";
import { repos } from "@/lib/repositories";
import { CACHE_TAGS } from "@/lib/cache";
import { getCurrentSession } from "@/lib/supabase/server";
import { failure, readString, success, type ActionResult } from "./_helpers";
import {
  parseFewshots,
  serializeFewshots,
  type AiPromptTemplate,
} from "@/types/ai-prompt-template";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const nameSchema = z
  .string()
  .trim()
  .min(1, "テンプレート名を入力してください")
  .max(50, "テンプレート名は 50 文字以内にしてください");

const fewShotExampleSchema = z.object({
  title: z
    .string()
    .min(1, "タイトルを入力してください")
    .max(100, "タイトルは 100 文字以内にしてください"),
  store_meta: z
    .string()
    .min(1, "店舗情報を入力してください")
    .max(500, "店舗情報は 500 文字以内にしてください"),
  call_script_ideal: z
    .string()
    .min(1, "架電スクリプト例を入力してください")
    .max(2000, "架電スクリプト例は 2000 文字以内にしてください")
    .refine((v) => v.includes("{ASSIGNED_SALES}"), {
      message: "call_script_ideal に {ASSIGNED_SALES} を含めてください",
    }),
});

const fewshotsSchema = z
  .array(fewShotExampleSchema)
  .min(1, "Few-shot 例を 1 件以上入力してください")
  .max(10, "Few-shot 例は 10 件以内にしてください")
  .refine(
    (arr) =>
      arr.every(
        (ex) =>
          ex.title.length + ex.store_meta.length + ex.call_script_ideal.length <=
          4000,
      ),
    { message: "各 Few-shot 例の合計文字数は 4000 字以内にしてください" },
  );

const templateIdSchema = z.string().uuid();

function parseTemplateId(id: string): string | null {
  const result = templateIdSchema.safeParse(id);
  return result.success ? result.data : null;
}

/**
 * body 文字列を解析・検証し、正規化済み JSON 文字列を返す。
 * parseFewshots で構造チェックし、fewshotsSchema で詳細制約を検証する。
 */
function validateBody(
  raw: string,
): { ok: true; normalized: string } | { ok: false; error: string } {
  const parsed = parseFewshots(raw);
  if (parsed === null) {
    return { ok: false, error: "テンプレートの内容が不正です" };
  }
  const result = fewshotsSchema.safeParse(parsed);
  if (!result.success) {
    const msg =
      result.error.issues[0]?.message ?? "テンプレートの内容が不正です";
    return { ok: false, error: msg };
  }
  return { ok: true, normalized: serializeFewshots(result.data) };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** 自分のテンプレート一覧を返す (作成日時 DESC)。 */
export async function listPromptTemplatesAction(): Promise<
  ActionResult<AiPromptTemplate[]>
> {
  const session = await getCurrentSession();
  if (!session) return failure("ログインが必要です");

  const templates = await repos.promptTemplate.list(session.userId);
  return success(templates);
}

/**
 * テンプレートを新規作成する。
 * - 1 ユーザー最大 5 件制限
 * - 初回作成時のみ is_default: true
 */
export async function createPromptTemplateAction(
  formData: FormData,
): Promise<ActionResult<AiPromptTemplate>> {
  const session = await getCurrentSession();
  if (!session) return failure("ログインが必要です");

  const rawName = readString(formData, "name");
  const nameResult = nameSchema.safeParse(rawName);
  if (!nameResult.success) {
    return failure(nameResult.error.issues[0]?.message ?? "入力が不正です");
  }

  const rawBody = readString(formData, "body");
  const bodyResult = validateBody(rawBody);
  if (!bodyResult.ok) return failure(bodyResult.error);

  try {
    const template = await repos.transaction(async (tx) => {
      const count = await tx.promptTemplate.countByUser(session.userId);
      if (count >= 5) throw new Error("LIMIT_EXCEEDED");
      return tx.promptTemplate.insert({
        user_id: session.userId,
        name: nameResult.data,
        is_default: count === 0,
        body: bodyResult.normalized,
      });
    });

    revalidateTag(CACHE_TAGS.promptTemplates, "max");
    return success(template);
  } catch (e) {
    if (e instanceof Error && e.message === "LIMIT_EXCEEDED") {
      return failure("上限 5 件を超えました");
    }
    return failure("テンプレートの作成に失敗しました");
  }
}

/**
 * テンプレートの name / body を更新する。
 * is_default は変更しない (setDefaultPromptTemplateAction に分離)。
 */
export async function updatePromptTemplateAction(
  formData: FormData,
): Promise<ActionResult<AiPromptTemplate>> {
  const session = await getCurrentSession();
  if (!session) return failure("ログインが必要です");

  const id = readString(formData, "id");
  if (!id) return failure("テンプレート ID が指定されていません");

  const validId = parseTemplateId(id);
  if (!validId) return failure("テンプレートが見つかりません");

  const rawName = readString(formData, "name");
  const nameResult = nameSchema.safeParse(rawName);
  if (!nameResult.success) {
    return failure(nameResult.error.issues[0]?.message ?? "入力が不正です");
  }

  const rawBody = readString(formData, "body");
  const bodyResult = validateBody(rawBody);
  if (!bodyResult.ok) return failure(bodyResult.error);

  const updated = await repos.promptTemplate.update(validId, session.userId, {
    name: nameResult.data,
    body: bodyResult.normalized,
  });

  if (!updated) return failure("テンプレートが見つかりません");

  revalidateTag(CACHE_TAGS.promptTemplates, "max");
  return success(updated);
}

/**
 * テンプレートを削除する。
 * デフォルトテンプレートは Server Action 側で事前に拒否 (DB trigger の二重ガード)。
 */
export async function deletePromptTemplateAction(
  id: string,
): Promise<ActionResult<boolean>> {
  const session = await getCurrentSession();
  if (!session) return failure("ログインが必要です");

  const validId = parseTemplateId(id);
  if (!validId) return failure("テンプレートが見つかりません");

  const template = await repos.promptTemplate.findById(validId, session.userId);
  if (!template) return failure("テンプレートが見つかりません");
  if (template.is_default) {
    return failure("デフォルトテンプレートは削除できません");
  }

  const deleted = await repos.promptTemplate.delete(validId, session.userId);
  if (!deleted) return failure("テンプレートが見つかりません");

  revalidateTag(CACHE_TAGS.promptTemplates, "max");
  return success(true);
}

/**
 * デフォルトテンプレートを切り替える。
 * repos.transaction() で clearDefault → set の 2 ステップを原子的に実行する。
 */
export async function setDefaultPromptTemplateAction(
  id: string,
): Promise<ActionResult<AiPromptTemplate>> {
  const session = await getCurrentSession();
  if (!session) return failure("ログインが必要です");

  const validId = parseTemplateId(id);
  if (!validId) return failure("テンプレートが見つかりません");

  const template = await repos.promptTemplate.findById(validId, session.userId);
  if (!template) return failure("テンプレートが見つかりません");

  try {
    const updated = await repos.transaction((tx) =>
      tx.promptTemplate.setDefault(validId, session.userId),
    );
    if (!updated) return failure("デフォルトテンプレートを変更できませんでした");

    revalidateTag(CACHE_TAGS.promptTemplates, "max");
    return success(updated);
  } catch {
    return failure("デフォルトテンプレートを変更できませんでした");
  }
}
