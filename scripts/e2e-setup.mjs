import postgres from "postgres";
import {
  buildAppEnv,
  E2E_TEST_USER_ID,
  getE2eConfig,
  runPnpm,
  startE2eDatabase,
  waitForE2eDatabase,
} from "./e2e-local.mjs";

async function ensureE2eProfile(localEnv, e2eConfig) {
  const sql = postgres(localEnv.DATABASE_URL, { prepare: false, max: 1 });
  const todayJst = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
  }).format(new Date());
  await sql`
    INSERT INTO auth.users (id, email, raw_user_meta_data)
    VALUES (${E2E_TEST_USER_ID}, ${e2eConfig.email}, ${JSON.stringify({ name: "E2E Test User" })}::jsonb)
    ON CONFLICT (id) DO UPDATE SET
      email = EXCLUDED.email,
      raw_user_meta_data = EXCLUDED.raw_user_meta_data
  `;
  await sql`
    INSERT INTO profiles (id, email, display_name, role, created_at, updated_at)
    VALUES (${E2E_TEST_USER_ID}, ${e2eConfig.email}, ${"E2E Test User"}, ${"member"}, ${todayJst}, ${todayJst})
    ON CONFLICT (id) DO UPDATE SET
      email = EXCLUDED.email,
      display_name = EXCLUDED.display_name,
      updated_at = EXCLUDED.updated_at
  `;
  await sql.end();
}

// 通知ベルの既読化 E2E (#296) 用の固定データ。毎回作り直して冪等にする。
// 参照先店舗の有無・リンク無し・既読済みの各ケースを 1 件ずつ用意する。
const E2E_NOTIFICATIONS = [
  {
    id: "notif_e2e_alive",
    title: "E2E: 導楽の調査が完了しました",
    link_url: "/stores/store_001",
    read_at: null,
  },
  {
    id: "notif_e2e_dead",
    title: "E2E: 削除済み店舗の通知",
    link_url: "/stores/store_e2e_deleted#deep-research",
    read_at: null,
  },
  {
    id: "notif_e2e_nolink",
    title: "E2E: リンクの無い通知",
    link_url: null,
    read_at: null,
  },
  {
    id: "notif_e2e_read",
    title: "E2E: 既読の通知",
    link_url: null,
    read_at: "2026-10-01",
  },
];

async function ensureE2eNotifications(localEnv) {
  const sql = postgres(localEnv.DATABASE_URL, { prepare: false, max: 1 });
  await sql`DELETE FROM notifications WHERE user_id = ${E2E_TEST_USER_ID}`;
  for (const [index, n] of E2E_NOTIFICATIONS.entries()) {
    // 並び順 (created_at DESC) を固定するため、配列順に新しい日付を振る。
    const createdAt = `2026-10-0${7 - index}`;
    await sql`
      INSERT INTO notifications (id, user_id, kind, title, body, link_url, read_at, created_at, updated_at)
      VALUES (${n.id}, ${E2E_TEST_USER_ID}, ${"research_job_completed"}, ${n.title}, ${"E2E 用の通知です"}, ${n.link_url}, ${n.read_at}, ${createdAt}, ${createdAt})
    `;
  }
  await sql.end();
}

async function ensureE2eAuthSchema(localEnv) {
  const sql = postgres(localEnv.DATABASE_URL, { prepare: false, max: 1 });
  await sql`CREATE SCHEMA IF NOT EXISTS auth`;
  await sql`
    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid PRIMARY KEY,
      email text,
      raw_user_meta_data jsonb
    )
  `;
  await sql.end();
}

async function main() {
  const e2eConfig = getE2eConfig();
  const localEnv = startE2eDatabase();
  await waitForE2eDatabase(localEnv.DATABASE_URL);
  await ensureE2eAuthSchema(localEnv);
  const appEnv = buildAppEnv(localEnv, e2eConfig);

  // 既存のDrizzle migrationとseedをローカルDBへ適用します。
  runPnpm(["db:migrate"], appEnv);
  runPnpm(["seed"], appEnv);
  await ensureE2eProfile(localEnv, e2eConfig);
  await ensureE2eNotifications(localEnv);

  console.log(`[e2e] local environment is ready: ${e2eConfig.baseUrl}`);
  console.log(`[e2e] test user: ${e2eConfig.email}`);
}

main().catch((error) => {
  console.error("[e2e] setup failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
