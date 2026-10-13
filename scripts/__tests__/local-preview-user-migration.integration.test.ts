/**
 * ローカル検証環境のテストユーザーを旧 ID から新 ID へ移し替える処理を、実 PostgreSQL で確かめる (#355)。
 *
 * 移し替えの成否は、トリガー (`private.handle_new_user()`)、`profiles.email` の一意制約、
 * 外部キーの ON DELETE CASCADE が絡むため、mock DB では証明できない。CI の
 * `Audit DB integration` job (migration 適用済みの postgres:15-alpine) で実行する。
 *
 * 他の結合テストと DB を共有するため、各テストはトランザクション内で行い、最後に ROLLBACK する。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  LEGACY_LOCAL_USER_ID,
  LOCAL_USER_ID,
  migrateLegacyLocalUser,
} from "../local-preview.mjs";

const EMAIL = "local@example.test";
const OTHER_USER_ID = "33333333-3333-4333-8333-333333333333";

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

/** 旧 ID のテストユーザーと、それを参照する行を作る (#355 より前の準備処理と同じ状態)。 */
async function seedLegacyUser(tx: postgres.TransactionSql): Promise<void> {
  await tx`INSERT INTO auth.users (id, email, raw_user_meta_data)
    VALUES (${LEGACY_LOCAL_USER_ID}, ${EMAIL}, ${JSON.stringify({ name: "Local Test User" })}::jsonb)`;
  await tx`UPDATE profiles SET role = 'admin', display_name = 'Local Test User', created_at = '2026-10-01'
    WHERE id = ${LEGACY_LOCAL_USER_ID}`;
  await tx`INSERT INTO auth.users (id, email, raw_user_meta_data)
    VALUES (${OTHER_USER_ID}, 'other@example.test', '{}'::jsonb)`;
  await tx`INSERT INTO notifications (id, user_id, kind, title, body, created_at, updated_at) VALUES
    ('notif_355_legacy', ${LEGACY_LOCAL_USER_ID}, 'research_job_completed', 't', 'b', '2026-10-01', '2026-10-01'),
    ('notif_355_other', ${OTHER_USER_ID}, 'research_job_completed', 't', 'b', '2026-10-01', '2026-10-01')`;
  // ON DELETE CASCADE の参照。旧ユーザーを消す前に付け替えないと、一緒に消える。
  await tx`INSERT INTO ai_prompt_templates (user_id, name, is_default, body, created_at, updated_at)
    VALUES (${LEGACY_LOCAL_USER_ID}, '既定', true, '{"fewshots":[]}', '2026-10-01', '2026-10-01')`;
}

describe("migrateLegacyLocalUser (#355)", () => {
  let sql: postgres.Sql;

  beforeAll(() => {
    const databaseUrl = process.env.DATABASE_URL ?? "";
    expect(databaseUrl, "DATABASE_URL must point at the integration database").not.toBe("");
    sql = postgres(databaseUrl, { prepare: false, max: 1 });
  });

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  it("旧 ID のユーザーを新 ID へ移し、参照をすべて付け替える", async () => {
    await inRolledBackTransaction(sql, async (tx) => {
      await seedLegacyUser(tx);

      const moved = await migrateLegacyLocalUser(tx);

      expect(moved).toEqual(expect.arrayContaining([
        { table: "ai_prompt_templates", column: "user_id", count: 1 },
        { table: "notifications", column: "user_id", count: 1 },
      ]));
      const profiles = await tx`SELECT id, email, display_name, role, created_at FROM profiles
        WHERE id IN (${LEGACY_LOCAL_USER_ID}, ${LOCAL_USER_ID})`;
      expect(profiles).toEqual([{
        id: LOCAL_USER_ID, email: EMAIL, display_name: "Local Test User", role: "admin", created_at: "2026-10-01",
      }]);
      const authUsers = await tx`SELECT id, email FROM auth.users
        WHERE id IN (${LEGACY_LOCAL_USER_ID}, ${LOCAL_USER_ID})`;
      expect(authUsers).toEqual([{ id: LOCAL_USER_ID, email: EMAIL }]);
      expect(await tx`SELECT user_id, is_default FROM ai_prompt_templates WHERE name = '既定'`)
        .toEqual([{ user_id: LOCAL_USER_ID, is_default: true }]);
      // 他のユーザーの行は動かさない
      expect(await tx`SELECT user_id FROM notifications WHERE id = 'notif_355_other'`)
        .toEqual([{ user_id: OTHER_USER_ID }]);

      // profiles.id を参照する列に、旧 ID が 1 件も残らない
      const references = await tx`
        SELECT c.conrelid::regclass::text AS "table", a.attname AS "column"
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
        WHERE c.contype = 'f' AND c.confrelid = 'public.profiles'::regclass`;
      expect(references.length).toBeGreaterThanOrEqual(6);
      for (const { table, column } of references) {
        const rows = await tx.unsafe(
          `SELECT count(*)::int AS n FROM ${table} WHERE "${column}" = $1`,
          [LEGACY_LOCAL_USER_ID],
        );
        expect(rows[0]?.n, `${table}.${column}`).toBe(0);
      }

      // 2 回目は何もしない
      expect(await migrateLegacyLocalUser(tx)).toBeNull();
    });
  });

  it("旧 ID のユーザーがいなければ何もしない", async () => {
    await inRolledBackTransaction(sql, async (tx) => {
      expect(await migrateLegacyLocalUser(tx)).toBeNull();
    });
  });

  it("旧 ID と新 ID の両方にユーザーがいれば、何も変えずに中止する", async () => {
    await inRolledBackTransaction(sql, async (tx) => {
      await seedLegacyUser(tx);
      await tx`INSERT INTO auth.users (id, email, raw_user_meta_data)
        VALUES (${LOCAL_USER_ID}, 'new@example.test', '{}'::jsonb)`;

      await expect(tx.savepoint((sp) => migrateLegacyLocalUser(sp))).rejects.toThrow("両方");
      expect(await tx`SELECT email FROM profiles WHERE id = ${LEGACY_LOCAL_USER_ID}`)
        .toEqual([{ email: EMAIL }]);
    });
  });
});
