/**
 * MembershipRepository / ProfileRepository を実 PostgreSQL で確かめる (マルチテナント化 #367)。
 *
 * - ロールは memberships から読み、profiles.role は読まない (値を食い違わせて確かめる)
 * - 所属の無いユーザーは find で null、list に出ない
 * - 別テナントの所属・ロールが混ざらない
 * - ProfileRepository は人の情報だけを返し、role を持たない
 *
 * CI の `Audit DB integration` job (migration 適用済みの postgres:15-alpine) で実行する。
 * 他の結合テストと DB を共有するため、各テストはトランザクション内で行い、最後に ROLLBACK する。
 */
import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

const { db } = await import("@/lib/db/client");
const { makeMembershipRepo } = await import("@/lib/db/membership-repository");
const { makeProfileRepo } = await import("@/lib/db/profile-repository");
const { FIRSTWEB_TENANT_ID } = await import("@/lib/db/schema");

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const USER_A = "a3670000-0000-4000-8000-000000000001";
const USER_B = "a3670000-0000-4000-8000-000000000002";
const USER_C = "a3670000-0000-4000-8000-000000000003";
const OTHER_TENANT = "a3670000-0000-4000-8000-0000000000ff";

/** `work` を実行した後、必ず ROLLBACK する。 */
async function inRolledBackTransaction(work: (tx: Tx) => Promise<void>): Promise<void> {
  const rollback = new Error("rollback");
  await expect(
    db.transaction(async (tx) => {
      await work(tx);
      throw rollback;
    }),
  ).rejects.toBe(rollback);
}

/** トリガー経由でユーザーを作る (プロフィールと Firstweb の所属 member ができる)。 */
async function createUser(tx: Tx, id: string, email: string): Promise<void> {
  await tx.execute(sql`INSERT INTO auth.users (id, email, raw_user_meta_data)
    VALUES (${id}, ${email}, '{}'::jsonb)`);
}

describe("MembershipRepository (#367)", () => {
  it("ロールは memberships から読み、profiles.role は読まない", async () => {
    await inRolledBackTransaction(async (tx) => {
      await createUser(tx, USER_A, "a-367@example.test");
      // profiles.role だけを admin にする。所属は member のまま
      await tx.execute(sql`UPDATE profiles SET role = 'admin' WHERE id = ${USER_A}`);

      const member = await makeMembershipRepo(tx).find(FIRSTWEB_TENANT_ID, USER_A);

      expect(member).toMatchObject({ id: USER_A, email: "a-367@example.test", role: "member" });
    });
  });

  it("所属の無いユーザーは find で null、list にも出ない", async () => {
    await inRolledBackTransaction(async (tx) => {
      await createUser(tx, USER_A, "a-367@example.test");
      await createUser(tx, USER_B, "b-367@example.test");
      await tx.execute(sql`DELETE FROM memberships WHERE user_id = ${USER_B}`);
      const repo = makeMembershipRepo(tx);

      expect(await repo.find(FIRSTWEB_TENANT_ID, USER_B)).toBeNull();
      const ids = (await repo.list(FIRSTWEB_TENANT_ID)).map((m) => m.id);
      expect(ids).toContain(USER_A);
      expect(ids).not.toContain(USER_B);
    });
  });

  it("list の excludePlaceholders は placeholder の所属を除く", async () => {
    await inRolledBackTransaction(async (tx) => {
      await createUser(tx, USER_A, "a-367@example.test");
      await createUser(tx, USER_C, "c-367@example.test");
      await tx.execute(sql`UPDATE memberships SET role = 'placeholder' WHERE user_id = ${USER_C}`);
      const repo = makeMembershipRepo(tx);

      const all = (await repo.list(FIRSTWEB_TENANT_ID)).map((m) => m.id);
      const real = (await repo.list(FIRSTWEB_TENANT_ID, { excludePlaceholders: true })).map((m) => m.id);
      expect(all).toEqual(expect.arrayContaining([USER_A, USER_C]));
      expect(real).toContain(USER_A);
      expect(real).not.toContain(USER_C);
    });
  });

  it("updateRole は所属を更新して返し、所属が無ければ null。countAdmins はそのテナントだけを数える", async () => {
    await inRolledBackTransaction(async (tx) => {
      await createUser(tx, USER_A, "a-367@example.test");
      await createUser(tx, USER_B, "b-367@example.test");
      await tx.execute(sql`DELETE FROM memberships WHERE user_id = ${USER_B}`);
      // 別テナントに USER_B を admin として所属させる
      await tx.execute(sql`INSERT INTO tenants (id, slug, name, created_at, updated_at)
        VALUES (${OTHER_TENANT}, 'other-367', 'Other', '2026-10-19', '2026-10-19')`);
      await tx.execute(sql`INSERT INTO memberships (tenant_id, user_id, role, created_at, updated_at)
        VALUES (${OTHER_TENANT}, ${USER_B}, 'admin', '2026-10-19', '2026-10-19')`);
      const repo = makeMembershipRepo(tx);
      const before = await repo.countAdmins(FIRSTWEB_TENANT_ID);

      const updated = await repo.updateRole(FIRSTWEB_TENANT_ID, USER_A, "admin");

      expect(updated).toMatchObject({ id: USER_A, role: "admin" });
      expect(await repo.countAdmins(FIRSTWEB_TENANT_ID)).toBe(before + 1);
      expect(await repo.countAdmins(OTHER_TENANT)).toBe(1);
      // Firstweb に所属していない USER_B は、別テナントで admin でも更新できない
      expect(await repo.updateRole(FIRSTWEB_TENANT_ID, USER_B, "admin")).toBeNull();
      expect(await repo.find(FIRSTWEB_TENANT_ID, USER_B)).toBeNull();
      expect(await repo.find(OTHER_TENANT, USER_B)).toMatchObject({ role: "admin" });
    });
  });
});

describe("ProfileRepository (#367)", () => {
  it("人の情報だけを返し、role を持たない", async () => {
    await inRolledBackTransaction(async (tx) => {
      await createUser(tx, USER_A, "a-367@example.test");
      const repo = makeProfileRepo(tx);

      const profile = await repo.findById(USER_A);
      const listed = (await repo.findAll()).find((p) => p.id === USER_A);

      expect(profile).toMatchObject({ id: USER_A, email: "a-367@example.test" });
      expect(profile).not.toHaveProperty("role");
      expect(listed).not.toHaveProperty("role");
    });
  });
});
