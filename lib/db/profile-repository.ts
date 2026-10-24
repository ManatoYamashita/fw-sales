/**
 * ProfileRepository の Drizzle 実装 (auth-and-notifications spec, Issue #16)
 *
 * 役割:
 * - `lib/repositories/profile-repository.ts` の `ProfileRepository` interface を Drizzle で 1:1 実装する
 * - `makeProfileRepo(executor, tenantId)` ファクトリで `DbClient` または `Tx` を受け取り、
 *   トランザクション境界を呼び出し側 (Action) で制御できるようにする
 *
 * 制約:
 * - `import "server-only"` を必ず付け、Client バンドルへの混入を防ぐ
 * - 列は明示して選び、`profiles.role` は読まない。ロールは `memberships` が正で、
 *   `profiles.role` は #376 で撤去する (マルチテナント化 #367)
 *
 * 関連: design.md §「ProfileRepository」, requirements.md §2.1, §2.5, §3.4, §3.5, §3.7
 */

import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { type DbClient, type Tx } from "./client";
import { memberships, profiles } from "./schema";
import type { ProfileRepository } from "@/lib/repositories/profile-repository";
import type { Profile } from "@/types/profile";

const profileColumns = {
  id: profiles.id,
  email: profiles.email,
  display_name: profiles.display_name,
  avatar_url: profiles.avatar_url,
  created_at: profiles.created_at,
  updated_at: profiles.updated_at,
};

function fromDbRow(row: Profile): Profile {
  return {
    id: row.id,
    email: row.email,
    display_name: row.display_name,
    avatar_url: row.avatar_url,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * `ProfileRepository` を Drizzle で実装するファクトリ。
 */
export function makeProfileRepo(executor: DbClient | Tx, tenantId: string): ProfileRepository {
  return {
    async findById(id) {
      const rows = await executor
        .select(profileColumns)
        .from(profiles)
        .innerJoin(memberships, and(eq(memberships.user_id, profiles.id), eq(memberships.tenant_id, tenantId)))
        .where(eq(profiles.id, id))
        .limit(1);
      const head = rows[0];
      return head ? fromDbRow(head) : null;
    },

    async findByEmail(email) {
      const rows = await executor
        .select(profileColumns)
        .from(profiles)
        .innerJoin(memberships, and(eq(memberships.user_id, profiles.id), eq(memberships.tenant_id, tenantId)))
        .where(eq(profiles.email, email))
        .limit(1);
      const head = rows[0];
      return head ? fromDbRow(head) : null;
    },

    async findByDisplayName(name) {
      const rows = await executor
        .select(profileColumns)
        .from(profiles)
        .innerJoin(memberships, and(eq(memberships.user_id, profiles.id), eq(memberships.tenant_id, tenantId)))
        .where(eq(profiles.display_name, name))
        .limit(1);
      const head = rows[0];
      return head ? fromDbRow(head) : null;
    },

    async findManyByIds(ids) {
      if (ids.length === 0) return [];
      const rows = await executor
        .select(profileColumns)
        .from(profiles)
        .innerJoin(memberships, and(eq(memberships.user_id, profiles.id), eq(memberships.tenant_id, tenantId)))
        .where(inArray(profiles.id, [...ids]));
      return rows.map(fromDbRow);
    },

    async findAll() {
      const rows = await executor.select(profileColumns).from(profiles)
        .innerJoin(memberships, and(eq(memberships.user_id, profiles.id), eq(memberships.tenant_id, tenantId)));
      return rows.map(fromDbRow);
    },
  };
}
