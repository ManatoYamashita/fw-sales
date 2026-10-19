/**
 * MembershipRepository の Drizzle 実装 (マルチテナント化 #365 / #367)
 *
 * - `makeMembershipRepo(executor)` で `DbClient` か `Tx` を受け取る (他の repository と同じ)
 * - プロフィールの列は明示して選び、`profiles.role` は読まない (#376 で撤去する列)
 */

import "server-only";
import { and, count, eq, inArray } from "drizzle-orm";
import { db, type DbClient, type Tx } from "./client";
import { memberships, profiles } from "./schema";
import type { MembershipRepository } from "@/lib/repositories/membership-repository";
import type { Member, ProfileRole } from "@/types/profile";
import { today } from "@/lib/utils/date";

/**
 * 既知のロール以外が DB に紛れ込んだ場合のフェイルセーフ。
 * 未知の値は member 扱い (権限拡張の取り違えを防ぐ安全側のデフォルト)。
 */
function asProfileRole(raw: string): ProfileRole {
  if (raw === "placeholder") return "placeholder";
  if (raw === "admin") return "admin";
  return "member";
}

const memberColumns = {
  id: profiles.id,
  email: profiles.email,
  display_name: profiles.display_name,
  avatar_url: profiles.avatar_url,
  created_at: profiles.created_at,
  updated_at: profiles.updated_at,
  role: memberships.role,
};

interface MemberRow {
  readonly id: string;
  readonly email: string;
  readonly display_name: string;
  readonly avatar_url: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly role: string;
}

function toMember(row: MemberRow): Member {
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
 * `MembershipRepository` を Drizzle で実装するファクトリ。
 */
export function makeMembershipRepo(executor: DbClient | Tx): MembershipRepository {
  async function find(tenantId: string, userId: string): Promise<Member | null> {
    const rows = await executor
      .select(memberColumns)
      .from(memberships)
      .innerJoin(profiles, eq(profiles.id, memberships.user_id))
      .where(and(eq(memberships.tenant_id, tenantId), eq(memberships.user_id, userId)))
      .limit(1);
    const head = rows[0];
    return head ? toMember(head) : null;
  }

  return {
    find,

    async list(tenantId, options = {}) {
      const inTenant = eq(memberships.tenant_id, tenantId);
      const rows = await executor
        .select(memberColumns)
        .from(memberships)
        .innerJoin(profiles, eq(profiles.id, memberships.user_id))
        .where(
          options.excludePlaceholders
            ? and(inTenant, inArray(memberships.role, ["member", "admin"]))
            : inTenant,
        );
      return rows.map(toMember);
    },

    async countAdmins(tenantId) {
      const rows = await executor
        .select({ n: count() })
        .from(memberships)
        .where(and(eq(memberships.tenant_id, tenantId), eq(memberships.role, "admin")));
      return rows[0]?.n ?? 0;
    },

    async updateRole(tenantId, userId, role) {
      // 純粋な UPDATE。認可・最後の管理者保護は Server Action 層 (#155) の責務。
      const updated = await executor
        .update(memberships)
        .set({ role, updated_at: today() })
        .where(and(eq(memberships.tenant_id, tenantId), eq(memberships.user_id, userId)))
        .returning({ userId: memberships.user_id });
      if (updated.length === 0) return null;
      return find(tenantId, userId);
    },
  };
}

/**
 * `db` singleton を束縛した既定 `MembershipRepository` インスタンス。
 */
export const dbMembershipRepo: MembershipRepository = makeMembershipRepo(db);
