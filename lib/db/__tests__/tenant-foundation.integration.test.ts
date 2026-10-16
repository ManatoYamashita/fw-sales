/**
 * テナント基盤の migration (0032, #366) が DB に作るものを、実 PostgreSQL で確かめる。
 *
 * 0032 は `lib/db/schema.ts` を変えない expand の migration で、アプリはまだ `tenant_id` を知らない。
 * この段階の約束 (既定値で Firstweb に入る・新規ユーザーに所属が作られる・クライアントから読めない) は、
 * DB のカタログと実際の INSERT でしか確かめられない。CI の `Audit DB integration` job
 * (migration 適用済みの postgres:15-alpine) で実行する。
 *
 * 既存データの移し替え (profiles → memberships、既存行の tenant_id) は、CI の DB が migration の
 * 時点で空のため、ここでは確かめられない。データの入った DB へ適用して確認する (#366 の PR に記録)。
 *
 * 他の結合テストと DB を共有するため、書き込むテストはトランザクション内で行い、最後に ROLLBACK する。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";

/** migration 0032 が固定値で作る Firstweb テナントの ID。 */
const FIRSTWEB_TENANT_ID = "cfe871a5-8fc7-42da-9677-3a050665cafb";

/** `tenant_id` を持つ業務テーブル。 */
const TENANT_SCOPED_TABLES = [
  "ai_prompt_templates",
  "app_settings",
  "deals",
  "event_logs",
  "handoffs",
  "notifications",
  "place_candidates",
  "store_research_runs",
  "stores",
];

/** 業務データや操作者を消しても証跡を残すため、外部キーを張らないテーブル。 */
const TABLES_WITHOUT_TENANT_FK = ["event_logs"];

const CLIENT_TABLES = ["public.tenants", "public.memberships"];
const TABLE_PRIVILEGES = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"];

/** `work` を実行した後、必ず ROLLBACK する。 */
async function inRolledBackTransaction(
  sql: postgres.Sql,
  work: (tx: postgres.TransactionSql) => Promise<void>,
): Promise<void> {
  const rollback = new Error("rollback");
  await expect(
    sql.begin(async (tx) => {
      await work(tx);
      throw rollback;
    }),
  ).rejects.toBe(rollback);
}

describe("テナント基盤の migration (#366)", () => {
  let sql: postgres.Sql;

  beforeAll(() => {
    const databaseUrl = process.env.DATABASE_URL ?? "";
    expect(databaseUrl, "DATABASE_URL must point at the integration database").not.toBe("");
    sql = postgres(databaseUrl, { prepare: false, max: 1 });
  });

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  it("Firstweb テナントが固定の ID で存在する", async () => {
    expect(await sql`SELECT id, slug, name FROM tenants WHERE id = ${FIRSTWEB_TENANT_ID}`)
      .toEqual([{ id: FIRSTWEB_TENANT_ID, slug: "firstweb", name: "Firstweb" }]);
  });

  it("業務テーブルの tenant_id は NOT NULL で、既定値が Firstweb", async () => {
    const columns = await sql`
      SELECT table_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'tenant_id'
        AND table_name = ANY(${TENANT_SCOPED_TABLES})`;
    expect(columns.map((column) => column.table_name).sort()).toEqual([...TENANT_SCOPED_TABLES].sort());
    for (const column of columns) {
      expect(column, column.table_name).toMatchObject({ data_type: "uuid", is_nullable: "NO" });
      expect(column.column_default, column.table_name).toContain(FIRSTWEB_TENANT_ID);
    }
  });

  it("tenants への外部キーはテナントの削除を拒否し、event_logs には張らない", async () => {
    const references = await sql`
      SELECT conrelid::regclass::text AS child, confdeltype
      FROM pg_constraint
      WHERE contype = 'f' AND confrelid = 'public.tenants'::regclass`;
    const expected = [
      ...TENANT_SCOPED_TABLES.filter((table) => !TABLES_WITHOUT_TENANT_FK.includes(table)),
      "memberships",
    ].sort();
    expect(references.map((reference) => reference.child).sort()).toEqual(expected);
    for (const reference of references) {
      // "r" = ON DELETE RESTRICT
      expect(reference.confdeltype, reference.child).toBe("r");
    }

    await inRolledBackTransaction(sql, async (tx) => {
      await tx`INSERT INTO app_settings (key, value, updated_at)
        VALUES ('tenant_foundation_restrict', 'v', '2026-10-17')`;
      await expect(tx.savepoint((sp) => sp`DELETE FROM tenants WHERE id = ${FIRSTWEB_TENANT_ID}`))
        .rejects.toMatchObject({ code: "23503" });
    });
  });

  it("tenant_id を指定しない INSERT は Firstweb に入る (tenant_id を知らない今のアプリの書き込み)", async () => {
    await inRolledBackTransaction(sql, async (tx) => {
      const rows = await tx`INSERT INTO app_settings (key, value, updated_at)
        VALUES ('tenant_foundation_default', 'v', '2026-10-17') RETURNING tenant_id`;
      expect(rows).toEqual([{ tenant_id: FIRSTWEB_TENANT_ID }]);
    });
  });

  it("新規ユーザーには、プロフィールと Firstweb の所属 (member) が作られる", async () => {
    const userId = "66666666-6666-4666-8666-666666666666";
    await inRolledBackTransaction(sql, async (tx) => {
      await tx`INSERT INTO auth.users (id, email, raw_user_meta_data)
        VALUES (${userId}, 'tenant-foundation@example.test', '{}'::jsonb)`;

      expect(await tx`SELECT role FROM profiles WHERE id = ${userId}`).toEqual([{ role: "member" }]);
      expect(await tx`SELECT tenant_id, role FROM memberships WHERE user_id = ${userId}`)
        .toEqual([{ tenant_id: FIRSTWEB_TENANT_ID, role: "member" }]);
    });
  });

  it("所属は (テナント, ユーザー) で一意で、ユーザーを消すと一緒に消える", async () => {
    const userId = "77777777-7777-4777-8777-777777777777";
    await inRolledBackTransaction(sql, async (tx) => {
      await tx`INSERT INTO auth.users (id, email, raw_user_meta_data)
        VALUES (${userId}, 'tenant-foundation-2@example.test', '{}'::jsonb)`;
      await expect(tx.savepoint((sp) => sp`
        INSERT INTO memberships (tenant_id, user_id, role, created_at, updated_at)
        VALUES (${FIRSTWEB_TENANT_ID}, ${userId}, 'admin', '2026-10-17', '2026-10-17')`))
        .rejects.toMatchObject({ code: "23505" });

      await tx`DELETE FROM auth.users WHERE id = ${userId}`;

      expect(await tx`SELECT count(*)::int AS n FROM memberships WHERE user_id = ${userId}`)
        .toEqual([{ n: 0 }]);
    });
  });

  it("tenants と memberships は RLS が有効で、クライアントの権限が無い", async () => {
    expect(await sql`
      SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
      WHERE oid IN ('public.tenants'::regclass, 'public.memberships'::regclass)
      ORDER BY relname`).toEqual([
      { relname: "memberships", relrowsecurity: true, relforcerowsecurity: false },
      { relname: "tenants", relrowsecurity: true, relforcerowsecurity: false },
    ]);
    expect(await sql`
      SELECT count(*)::int AS n FROM pg_policy
      WHERE polrelid IN ('public.tenants'::regclass, 'public.memberships'::regclass)`)
      .toEqual([{ n: 0 }]);

    // Supabase 固有のロールは通常の PostgreSQL には無いため、存在するものだけを調べる。
    const supabaseRoles = await sql`
      SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')`;
    const roles = ["public", ...supabaseRoles.map((role) => role.rolname as string)];
    for (const role of roles) {
      for (const table of CLIENT_TABLES) {
        for (const privilege of TABLE_PRIVILEGES) {
          expect(
            await sql`SELECT has_table_privilege(${role}, ${table}, ${privilege}) AS allowed`,
            `${role} ${privilege} ${table}`,
          ).toEqual([{ allowed: false }]);
        }
      }
    }
  });

  it("handle_new_user は置き換え後も SECURITY DEFINER と search_path の固定、実行権限の撤回を保つ", async () => {
    expect(await sql`
      SELECT prosecdef, proconfig FROM pg_proc WHERE oid = 'private.handle_new_user'::regproc`)
      .toEqual([{ prosecdef: true, proconfig: ["search_path=public, pg_temp"] }]);
    expect(await sql`
      SELECT has_function_privilege('public', 'private.handle_new_user()', 'EXECUTE') AS allowed`)
      .toEqual([{ allowed: false }]);
  });
});
