/**
 * PromptTemplateRepository の Drizzle 実装 (Issue #42)
 *
 * `lib/repositories/prompt-template-repository.ts` の interface を Drizzle で 1:1 実装。
 *
 * 制約:
 * - `import "server-only"` を必ず付け、Client バンドルへの混入を防ぐ
 * - すべての取得・更新・削除クエリで `user_id = userId` 条件を必ず含める
 *   (他ユーザーのテンプレートへのアクセスを repository 層で防御)
 * - `setDefault` は clearDefaultForUser → update の 2 ステップで構成。
 *   原子性が必要な場合は呼び出し側が `repos.transaction()` で包み、
 *   Tx executor を渡すこと。
 * - デフォルトテンプレートの削除は DB trigger (migration 0009) で拒否される。
 *   Server Action 側でも Phase 2 で二重ガードを実装する予定。
 *
 * 関連: design §「PromptTemplateRepository」, Issue #42
 */

import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";
import { db, type DbClient, type Tx } from "./client";
import { aiPromptTemplates } from "./schema";
import type { PromptTemplateRepository } from "@/lib/repositories/prompt-template-repository";
import type { AiPromptTemplate } from "@/types/ai-prompt-template";
import { today } from "@/lib/utils/date";

type TemplateRow = typeof aiPromptTemplates.$inferSelect;

function fromDbRow(row: TemplateRow): AiPromptTemplate {
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    is_default: row.is_default,
    body: row.body,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function makePromptTemplateRepo(
  executor: DbClient | Tx,
): PromptTemplateRepository {
  return {
    async list(userId) {
      const rows = await executor
        .select()
        .from(aiPromptTemplates)
        .where(eq(aiPromptTemplates.user_id, userId))
        .orderBy(desc(aiPromptTemplates.created_at));
      return rows.map(fromDbRow);
    },

    async findById(id, userId) {
      const rows = await executor
        .select()
        .from(aiPromptTemplates)
        .where(
          and(
            eq(aiPromptTemplates.id, id),
            eq(aiPromptTemplates.user_id, userId),
          ),
        )
        .limit(1);
      const head = rows[0];
      return head ? fromDbRow(head) : null;
    },

    async insert(input) {
      const now = today();
      const rows = await executor
        .insert(aiPromptTemplates)
        .values({
          user_id: input.user_id,
          name: input.name,
          is_default: input.is_default,
          body: input.body,
          created_at: now,
          updated_at: now,
        })
        .returning();
      const head = rows[0];
      if (!head) throw new Error("[prompt-template] insert returned no row");
      return fromDbRow(head);
    },

    async update(id, userId, patch) {
      const now = today();
      const rows = await executor
        .update(aiPromptTemplates)
        .set({ ...patch, updated_at: now })
        .where(
          and(
            eq(aiPromptTemplates.id, id),
            eq(aiPromptTemplates.user_id, userId),
          ),
        )
        .returning();
      const head = rows[0];
      return head ? fromDbRow(head) : null;
    },

    async delete(id, userId) {
      const rows = await executor
        .delete(aiPromptTemplates)
        .where(
          and(
            eq(aiPromptTemplates.id, id),
            eq(aiPromptTemplates.user_id, userId),
          ),
        )
        .returning({ id: aiPromptTemplates.id });
      return rows.length > 0;
    },

    async countByUser(userId) {
      const rows = await executor
        .select({ count: sql<number>`count(*)::int` })
        .from(aiPromptTemplates)
        .where(eq(aiPromptTemplates.user_id, userId));
      return rows[0]?.count ?? 0;
    },

    async clearDefaultForUser(userId) {
      await executor
        .update(aiPromptTemplates)
        .set({ is_default: false, updated_at: today() })
        .where(eq(aiPromptTemplates.user_id, userId));
    },

    async setDefault(id, userId) {
      // Step 1: 対象テンプレートの存在確認 (userId 条件で他ユーザー保護)
      // 存在しない場合は何も変更せず null を返す
      const existing = await executor
        .select()
        .from(aiPromptTemplates)
        .where(
          and(
            eq(aiPromptTemplates.id, id),
            eq(aiPromptTemplates.user_id, userId),
          ),
        )
        .limit(1);
      if (!existing[0]) return null;

      // Step 2: 指定ユーザーの既存デフォルトを解除
      await executor
        .update(aiPromptTemplates)
        .set({ is_default: false, updated_at: today() })
        .where(eq(aiPromptTemplates.user_id, userId));

      // Step 3: 指定テンプレートをデフォルトに設定
      const rows = await executor
        .update(aiPromptTemplates)
        .set({ is_default: true, updated_at: today() })
        .where(
          and(
            eq(aiPromptTemplates.id, id),
            eq(aiPromptTemplates.user_id, userId),
          ),
        )
        .returning();
      const head = rows[0];
      return head ? fromDbRow(head) : null;
    },
  };
}

export const dbPromptTemplateRepo: PromptTemplateRepository =
  makePromptTemplateRepo(db);
