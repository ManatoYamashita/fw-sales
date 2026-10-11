import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { chromium } from "@playwright/test";
import {
  PROJECT_ROOT,
  runPnpm,
  waitForE2eDatabase,
} from "./e2e-local.mjs";

export const LOCAL_CONTAINER_NAME = "fw-sales-local-postgres";
// 監査ログの actor は `z.string().uuid()` で検証する (lib/observability/serialize.ts)。
// zod 4 は UUID の版 (v1〜v8) と variant まで検査するので、v4 の形にしておく (#355)。
export const LOCAL_USER_ID = "00000000-0000-4000-8000-000000000002";
/** #355 より前の ID。版が 0 のため監査の検証を通らない。既存 DB は準備処理で移し替える。 */
export const LEGACY_LOCAL_USER_ID = "00000000-0000-0000-0000-000000000002";
const LOCAL_OWNER_LABEL = "fw-sales.environment=local-preview";
const LOCAL_STATE_DIR = path.join(PROJECT_ROOT, ".local-preview");

/** @param {Record<string, string | undefined>} env */
export function getLocalPreviewConfig(env = process.env) {
  const rawPort = env.LOCAL_PREVIEW_PORT ?? "3200";
  const port = Number(rawPort);
  if (!/^\d+$/.test(rawPort) || !Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("LOCAL_PREVIEW_PORTは1024〜65535の整数で指定してください。");
  }
  return { port, baseUrl: `http://127.0.0.1:${port}`, email: "local@example.test" };
}

// DB接続先は、このスクリプトが管理するコンテナから取得します。
// 呼び出し元や.env.localに設定された本番接続情報を使いません。
/**
 * @param {string} databaseUrl
 * @param {{port: number, baseUrl: string, email: string}} config
 * @param {string} secret
 * @param {Record<string, string | undefined>} baseEnv
 * @returns {Record<string, string | undefined>}
 */
export function buildLocalPreviewEnv(databaseUrl, config, secret, baseEnv = process.env) {
  return {
    ...baseEnv,
    DATABASE_URL: databaseUrl,
    DATABASE_POOL_MAX: "1",
    NODE_ENV: "development",
    APP_ENV: "local",
    VERCEL: "",
    VERCEL_ENV: "development",
    VERCEL_OIDC_TOKEN: "",
    VERCEL_URL: "",
    NEXT_PUBLIC_APP_URL: config.baseUrl,
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "local-not-used",
    SUPABASE_SERVICE_ROLE_KEY: "local-not-used",
    GOOGLE_OAUTH_CLIENT_ID: "",
    GOOGLE_OAUTH_CLIENT_SECRET: "",
    GOOGLE_PLACES_API_KEY: "",
    NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: "",
    GEMINI_API_KEY: "",
    CRON_SECRET: "",
    E2E_TEST_MODE: "1",
    E2E_TEST_USER_ID: LOCAL_USER_ID,
    E2E_TEST_EMAIL: config.email,
    E2E_TEST_PASSWORD: "local-not-used",
    E2E_TEST_SECRET: secret,
    ALLOW_DATA_RESET: "1",
  };
}

function runContainer(args, inherit = false) {
  return execFileSync("container", args, {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
    stdio: inherit ? "inherit" : "pipe",
  });
}

function findContainer() {
  const containers = JSON.parse(runContainer(["list", "--all", "--format", "json"]));
  const target = containers.find((container) => container.id === LOCAL_CONTAINER_NAME);
  if (target && target.configuration.labels?.["fw-sales.environment"] !== "local-preview") {
    throw new Error("同名のコンテナが別用途で存在するため、操作を中止しました。");
  }
  return target;
}

function getLocalDatabaseUrl() {
  const target = findContainer();
  const address = target?.status?.networks?.[0]?.ipv4Address?.split("/")[0];
  if (target?.status?.state !== "running" || !address) {
    throw new Error("ローカル検証DBが起動していません。pnpm local:setupを実行してください。");
  }
  return `postgres://postgres:postgres@${address}:5432/postgres`;
}

function readLocalSecret() {
  fs.mkdirSync(LOCAL_STATE_DIR, { recursive: true, mode: 0o700 });
  const secretPath = path.join(LOCAL_STATE_DIR, "auth-secret");
  if (!fs.existsSync(secretPath)) {
    fs.writeFileSync(secretPath, randomBytes(32).toString("hex"), { mode: 0o600, flag: "wx" });
  }
  return fs.readFileSync(secretPath, "utf8").trim();
}

/** @param {string} name */
const quoteIdent = (name) => `"${name.replaceAll('"', '""')}"`;

/**
 * 旧 ID (`LEGACY_LOCAL_USER_ID`) のテストユーザーを、新 ID (`LOCAL_USER_ID`) へ移し替える (#355)。
 *
 * ローカル検証 DB はデータを持ち越すため、ID の定数を変えるだけでは、新 ID の `auth.users` を
 * 作ったときにトリガー (`private.handle_new_user()`) が同じメールでプロフィールを作ろうとして
 * `profiles.email` の一意制約に当たる。そこで次の順に移す。
 *
 * 1. 旧プロフィールのメールを空ける
 * 2. 新 ID の `auth.users` を作り (トリガーがプロフィールを作る)、旧プロフィールの値を写す
 * 3. `profiles.id` を参照する外部キーをカタログから列挙し、旧 ID を新 ID へ付け替える
 * 4. 旧 `auth.users` を消す (旧プロフィールは ON DELETE CASCADE で消える)
 *
 * `event_logs.actor_user_id` は監査の証跡のため書き換えない (外部キーも無い)。
 * 呼び出し側のトランザクション内で実行すること。旧 ID のプロフィールが無ければ何もしない。
 *
 * @param {import("postgres").TransactionSql} tx
 * @returns {Promise<null | Array<{ table: string, column: string, count: number }>>}
 *   移し替えなければ null。移し替えたら、付け替えた参照の件数。
 */
export async function migrateLegacyLocalUser(tx) {
  const [legacy] = await tx`SELECT email FROM profiles WHERE id = ${LEGACY_LOCAL_USER_ID}`;
  if (!legacy) return null;
  const [current] = await tx`SELECT 1 FROM profiles WHERE id = ${LOCAL_USER_ID}`;
  if (current) {
    throw new Error(
      `テストユーザーが旧ID(${LEGACY_LOCAL_USER_ID})と新ID(${LOCAL_USER_ID})の両方にあるため、移し替えを中止しました。`,
    );
  }

  await tx`UPDATE profiles SET email = ${`legacy-${LEGACY_LOCAL_USER_ID}@local.invalid`}
    WHERE id = ${LEGACY_LOCAL_USER_ID}`;
  await tx`INSERT INTO auth.users (id, email, raw_user_meta_data)
    SELECT ${LOCAL_USER_ID}, ${legacy.email}, raw_user_meta_data FROM auth.users
    WHERE id = ${LEGACY_LOCAL_USER_ID}`;
  const columns = await tx`SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name NOT IN ('id', 'email')`;
  const assignments = columns
    .map(({ column_name: name }) => `${quoteIdent(name)} = source.${quoteIdent(name)}`)
    .join(", ");
  await tx.unsafe(
    `UPDATE profiles AS target SET ${assignments} FROM profiles AS source
      WHERE target.id = $1 AND source.id = $2`,
    [LOCAL_USER_ID, LEGACY_LOCAL_USER_ID],
  );

  const references = await tx`
    SELECT c.conrelid::regclass::text AS "table", a.attname AS "column", cardinality(c.conkey) AS width
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.contype = 'f' AND c.confrelid = 'public.profiles'::regclass
    ORDER BY 1, 2`;
  const moved = [];
  for (const { table, column, width } of references) {
    if (width !== 1) throw new Error(`${table} の複数列の外部キーは移し替えに対応していません。`);
    // table は regclass の文字列表現で、必要な引用符を含む。
    const result = await tx.unsafe(
      `UPDATE ${table} SET ${quoteIdent(column)} = $1 WHERE ${quoteIdent(column)} = $2`,
      [LOCAL_USER_ID, LEGACY_LOCAL_USER_ID],
    );
    if (result.count > 0) moved.push({ table, column, count: result.count });
  }

  await tx`DELETE FROM auth.users WHERE id = ${LEGACY_LOCAL_USER_ID}`;
  return moved;
}

async function setupLocalDatabase(config) {
  runContainer(["system", "start"], true);
  const target = findContainer();
  if (!target) {
    runContainer([
      "run", "--detach", "--name", LOCAL_CONTAINER_NAME,
      "--label", LOCAL_OWNER_LABEL,
      "--env", "POSTGRES_USER=postgres",
      "--env", "POSTGRES_PASSWORD=postgres",
      "--env", "POSTGRES_DB=postgres",
      "postgres:15-alpine",
    ], true);
  } else if (target.status.state !== "running") {
    runContainer(["start", LOCAL_CONTAINER_NAME], true);
  }
  const databaseUrl = getLocalDatabaseUrl();
  await waitForE2eDatabase(databaseUrl);
  const sql = postgres(databaseUrl, { prepare: false, max: 1 });
  try {
    await sql`CREATE SCHEMA IF NOT EXISTS auth`;
    await sql`CREATE TABLE IF NOT EXISTS auth.users (
      id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb
    )`;
    const env = buildLocalPreviewEnv(databaseUrl, config, readLocalSecret());
    runPnpm(["db:migrate"], env);
    const [{ count }] = await sql`SELECT count(*)::int AS count FROM stores`;
    // 再起動時のseed上書きを避け、初回の空DBにだけテストデータを投入します。
    if (count === 0) runPnpm(["seed"], env);
    const moved = await sql.begin((tx) => migrateLegacyLocalUser(tx));
    if (moved) {
      const detail = moved.map((m) => `${m.table}.${m.column} ${m.count}件`).join("、") || "参照なし";
      console.log(`[local] テストユーザーのIDを${LOCAL_USER_ID}へ移し替えました（${detail}）。起動中のdev:localは再起動してください。`);
    }
    const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());
    await sql`INSERT INTO auth.users (id, email, raw_user_meta_data)
      VALUES (${LOCAL_USER_ID}, ${config.email}, ${JSON.stringify({ name: "Local Test User" })}::jsonb)
      ON CONFLICT (id) DO NOTHING`;
    await sql`INSERT INTO profiles (id, email, display_name, role, created_at, updated_at)
      VALUES (${LOCAL_USER_ID}, ${config.email}, 'Local Test User', 'admin', ${today}, ${today})
      ON CONFLICT (id) DO UPDATE SET
        display_name = EXCLUDED.display_name, role = 'admin'`;
    console.log(`[local] DB準備完了: ${LOCAL_CONTAINER_NAME} / ${count === 0 ? "初回seed投入" : "既存データを保持"}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function startLocalServer(config) {
  await setupLocalDatabase(config);
  const env = buildLocalPreviewEnv(getLocalDatabaseUrl(), config, readLocalSecret());
  console.log(`[local] 検証URL: ${config.baseUrl}/stores`);
  console.log("[local] 別ターミナルでpnpm local:openを実行するとテストユーザーで開きます。");
  const child = spawn(process.execPath, [
    path.join(PROJECT_ROOT, "node_modules/next/dist/bin/next"),
    "dev", "--hostname", "127.0.0.1", "--port", String(config.port),
  ], { cwd: PROJECT_ROOT, env, stdio: "inherit", detached: process.platform !== "win32" });
  // Next.jsの子サーバーも同じプロセスグループへ終了シグナルを送ります。
  // pnpmだけを終了させると、サーバーが残って次回起動時にポートが競合します。
  const forwardSignal = (signal) => {
    if (process.platform === "win32") child.kill(signal);
    else if (child.pid) {
      try { process.kill(-child.pid, signal); }
      catch (error) { if (error.code !== "ESRCH") throw error; }
    }
  };
  const forwardInterrupt = () => forwardSignal("SIGINT");
  const forwardTerminate = () => forwardSignal("SIGTERM");
  process.on("SIGINT", forwardInterrupt);
  process.on("SIGTERM", forwardTerminate);
  await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      process.exitCode = code ?? (signal ? 1 : 0);
      process.removeListener("SIGINT", forwardInterrupt);
      process.removeListener("SIGTERM", forwardTerminate);
      resolve();
    });
  });
}

async function openLocalBrowser(config) {
  getLocalDatabaseUrl();
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || [
    chromium.executablePath(),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Aside.app/Contents/MacOS/Aside",
  ].find((candidate) => fs.existsSync(candidate));
  if (!executablePath) throw new Error("Chromiumが見つかりません。pnpm e2e:installを実行してください。");
  // 通常利用しているブラウザのプロファイルから分離します。
  const context = await chromium.launchPersistentContext(path.join(LOCAL_STATE_DIR, "browser"), {
    executablePath, headless: false,
  });
  try {
    const response = await context.request.get(`${config.baseUrl}/api/e2e/login?redirect=/stores`, {
      headers: { "x-e2e-secret": readLocalSecret() }, timeout: 30_000,
    });
    if (!response.ok()) throw new Error("ローカルログインに失敗しました。pnpm dev:localの起動を確認してください。");
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(`${config.baseUrl}/stores`);
    await page.getByRole("heading", { name: "店舗・営業一覧", exact: true }).waitFor({ timeout: 30_000 });
    console.log(`[local] ${config.email}（admin）でブラウザを開きました。`);
  } catch (error) {
    await context.close();
    throw error;
  }
  await new Promise((resolve) => context.on("close", resolve));
}

async function showStatus(config) {
  const target = findContainer();
  console.log(`[local] DB: ${target?.status.state ?? "未作成"}`);
  console.log(`[local] URL: ${config.baseUrl}/stores`);
  if (target?.status.state !== "running") return;
  const sql = postgres(getLocalDatabaseUrl(), { prepare: false, max: 1 });
  try {
    const [counts] = await sql`SELECT
      (SELECT count(*)::int FROM stores) AS stores,
      (SELECT count(*)::int FROM deals) AS deals,
      (SELECT count(*)::int FROM handoffs) AS handoffs,
      (SELECT role FROM profiles WHERE id = ${LOCAL_USER_ID}) AS local_user_role`;
    console.log("[local]", counts);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function main() {
  const config = getLocalPreviewConfig();
  switch (process.argv[2]) {
    case "setup": await setupLocalDatabase(config); break;
    case "start": await startLocalServer(config); break;
    case "open": await openLocalBrowser(config); break;
    case "status": await showStatus(config); break;
    case "stop": {
      const target = findContainer();
      if (target?.status.state === "running") runContainer(["stop", LOCAL_CONTAINER_NAME], true);
      console.log("[local] DBを停止しました。データは次回起動時にも保持されます。");
      break;
    }
    default: throw new Error("setup / start / open / status / stopを指定してください。");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error("[local]", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
