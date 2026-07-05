/**
 * ProfileRepository の Drizzle 実装 (auth-and-notifications spec, Issue #16)
 *
 * 役割:
 * - `lib/repositories/profile-repository.ts` の `ProfileRepository` interface を Drizzle で 1:1 実装する
 * - `makeProfileRepo(executor)` ファクトリで `DbClient` または `Tx` を受け取り、
 *   トランザクション境界を呼び出し側 (Action / scripts/backfill-assignees.ts) で制御できるようにする
 * - 既定 export `dbProfileRepo` は `db` (singleton) を束縛したインスタンス
 *
 * 制約:
 * - `import "server-only"` を必ず付け、Client バンドルへの混入を防ぐ
 * - `ProfileRepository` interface は無修正 (本仕様 §Boundary Commitments)
 * - `createPlaceholder` は `slug` から `placeholder-{slug}@local.invalid` 形式の
 *   email を組み立て、`role: 'placeholder'` で INSERT する。member プロフィール作成は
 *   trigger 側に閉じる (Req 2.1, 2.2)
 *
 * 関連: design.md §「ProfileRepository」, requirements.md §2.1, §2.5, §3.4, §3.5, §3.7
 */

import "server-only";
import { eq, inArray } from "drizzle-orm";
import { db, type DbClient, type Tx } from "./client";
import { profiles } from "./schema";
import type { ProfileRepository } from "@/lib/repositories/profile-repository";
import type {
  PlaceholderProfileInput,
  Profile,
  ProfileRole,
} from "@/types/profile";
import { today } from "@/lib/utils/date";

type ProfileSelectRow = typeof profiles.$inferSelect;

/**
 * 既知の role 値以外が DB に紛れ込んだ場合のフェイルセーフ。
 * 未知の値は member 扱い (権限拡張の取り違えを防ぐ安全側のデフォルト)。
 */
function asProfileRole(raw: string): ProfileRole {
  if (raw === "placeholder") return "placeholder";
  if (raw === "admin") return "admin";
  return "member";
}

function fromDbRow(row: ProfileSelectRow): Profile {
  return {
    id: row.id,
    email: row.email,
    display_name: row.display_name,
    avatar_url: row.avatar_url,
    role: asProfileRole(row.role),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * `ProfileRepository` を Drizzle で実装するファクトリ。
 */
export function makeProfileRepo(executor: DbClient | Tx): ProfileRepository {
  return {
    async findById(id) {
      const rows = await executor
        .select()
        .from(profiles)
        .where(eq(profiles.id, id))
        .limit(1);
      const head = rows[0];
      return head ? fromDbRow(head) : null;
    },

    async findByEmail(email) {
      const rows = await executor
        .select()
        .from(profiles)
        .where(eq(profiles.email, email))
        .limit(1);
      const head = rows[0];
      return head ? fromDbRow(head) : null;
    },

    async findByDisplayName(name) {
      const rows = await executor
        .select()
        .from(profiles)
        .where(eq(profiles.display_name, name))
        .limit(1);
      const head = rows[0];
      return head ? fromDbRow(head) : null;
    },

    async findManyByIds(ids) {
      if (ids.length === 0) return [];
      const rows = await executor
        .select()
        .from(profiles)
        .where(inArray(profiles.id, [...ids]));
      return rows.map(fromDbRow);
    },

    async findAll(options = {}) {
      if (options.excludePlaceholders) {
        const rows = await executor
          .select()
          .from(profiles)
          .where(inArray(profiles.role, ["member", "admin"]));
        return rows.map(fromDbRow);
      }
      const rows = await executor.select().from(profiles);
      return rows.map(fromDbRow);
    },

    async findAdmins() {
      const rows = await executor
        .select()
        .from(profiles)
        .where(eq(profiles.role, "admin"));
      return rows.map(fromDbRow);
    },

    async createPlaceholder(input: PlaceholderProfileInput) {
      const now = today();
      const id = crypto.randomUUID();
      const row: Profile = {
        id,
        email: `placeholder-${input.slug}@local.invalid`,
        display_name: input.displayName,
        avatar_url: null,
        role: "placeholder",
        created_at: now,
        updated_at: now,
      };
      await executor.insert(profiles).values(row);
      return row;
    },

    async updateRole(id, role) {
      // 純粋な UPDATE。認可・最後の管理者保護は Server Action 層 (#155) の責務。
      const rows = await executor
        .update(profiles)
        .set({ role, updated_at: today() })
        .where(eq(profiles.id, id))
        .returning();
      const head = rows[0];
      return head ? fromDbRow(head) : null;
    },
  };
}

/**
 * `db` singleton を束縛した既定 `ProfileRepository` インスタンス。
 */
export const dbProfileRepo: ProfileRepository = makeProfileRepo(db);
