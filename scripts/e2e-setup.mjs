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

  console.log(`[e2e] local environment is ready: ${e2eConfig.baseUrl}`);
  console.log(`[e2e] test user: ${e2eConfig.email}`);
}

main().catch((error) => {
  console.error("[e2e] setup failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
