import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_E2E_EMAIL = "e2e@example.test";
export const DEFAULT_E2E_PASSWORD = "e2e-password-please-change";
export const DEFAULT_E2E_SECRET = "local-e2e-only";
export const DEFAULT_E2E_PORT = 3100;
export const E2E_DB_CONTAINER_NAME = "fw-sales-e2e-postgres";
export const E2E_TEST_USER_ID = "00000000-0000-0000-0000-000000000001";

function commandExists(command) {
  return process.env.PATH?.split(path.delimiter).some((directory) => {
    const candidate = path.join(directory, command);
    try {
      return fs.statSync(candidate).isFile() && (fs.statSync(candidate).mode & 0o111) !== 0;
    } catch {
      return false;
    }
  }) ?? false;
}

function parsePort(value, name, defaultValue) {
  const port = Number.parseInt(value ?? String(defaultValue), 10);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(`${name} は1024〜65535の整数で指定してください。`);
  }
  return port;
}

export function getE2eConfig() {
  const port = parsePort(process.env.E2E_PORT, "E2E_PORT", DEFAULT_E2E_PORT);
  return {
    email: process.env.E2E_TEST_EMAIL?.trim() || DEFAULT_E2E_EMAIL,
    password: process.env.E2E_TEST_PASSWORD || DEFAULT_E2E_PASSWORD,
    secret: process.env.E2E_TEST_SECRET || DEFAULT_E2E_SECRET,
    port,
    baseUrl: `http://127.0.0.1:${port}`,
  };
}

export function getE2eDatabaseEnv() {
  const databaseHost = getE2eDatabaseHost();
  return {
    DATABASE_URL:
      process.env.E2E_DATABASE_URL ||
      `postgres://postgres:postgres@${databaseHost}:5432/postgres`,
  };
}

function getE2eDatabaseHost() {
  const output = execFileSync(
    "container",
    ["list", "--all", "--format", "json"],
    { cwd: PROJECT_ROOT, encoding: "utf8" },
  );
  const containers = JSON.parse(output);
  const target = containers.find((container) => container.id === E2E_DB_CONTAINER_NAME);
  const address = target?.status?.networks?.[0]?.ipv4Address;
  if (!address) {
    throw new Error("E2E用PostgreSQLコンテナの内部IPを取得できませんでした。");
  }
  return address.split("/")[0];
}

/**
 * Apple Container上でE2E専用PostgreSQLを起動します。
 * Supabase CLIはDocker Engine APIを要求するため、E2Eでは直接PostgreSQLを利用します。
 */
export function startE2eDatabase() {
  if (!commandExists("container")) {
    throw new Error(
      "Apple Containerのcontainerコマンドが見つかりません。Apple Containerをインストールしてください。",
    );
  }
  execFileSync("container", ["system", "start"], {
    cwd: PROJECT_ROOT,
    stdio: "inherit",
  });

  try {
    execFileSync("container", ["delete", "--force", E2E_DB_CONTAINER_NAME], {
      cwd: PROJECT_ROOT,
      stdio: "ignore",
    });
  } catch {
    // 初回起動時など、対象コンテナが存在しない場合はそのまま進めます。
  }

  execFileSync(
    "container",
    [
      "run",
      "--detach",
      "--rm",
      "--name",
      E2E_DB_CONTAINER_NAME,
      "--env",
      "POSTGRES_USER=postgres",
      "--env",
      "POSTGRES_PASSWORD=postgres",
      "--env",
      "POSTGRES_DB=postgres",
      "postgres:15-alpine",
    ],
    { cwd: PROJECT_ROOT, stdio: "inherit" },
  );

  return getE2eDatabaseEnv();
}

export async function waitForE2eDatabase(databaseUrl) {
  let lastError;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const sql = postgres(databaseUrl, {
      prepare: false,
      max: 1,
      connect_timeout: 2,
    });
    try {
      await sql`SELECT 1`;
      await sql.end();
      return;
    } catch (error) {
      lastError = error;
      await sql.end({ timeout: 1 }).catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error(
    `E2E用PostgreSQLの起動を待機できませんでした: ${lastError instanceof Error ? lastError.message : lastError}`,
  );
}

export function buildAppEnv(localEnv, e2eConfig) {
  return {
    ...process.env,
    ...localEnv,
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "e2e-not-used",
    SUPABASE_SERVICE_ROLE_KEY: "e2e-not-used",
    NEXT_PUBLIC_APP_URL: e2eConfig.baseUrl,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY || "e2e-not-used",
    DATABASE_POOL_MAX: "1",
    E2E_TEST_MODE: "1",
    E2E_TEST_USER_ID,
    E2E_TEST_EMAIL: e2eConfig.email,
    E2E_TEST_PASSWORD: e2eConfig.password,
    E2E_TEST_SECRET: e2eConfig.secret,
  };
}

export function runPnpm(args, env = process.env) {
  const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  execFileSync(command, args, { cwd: PROJECT_ROOT, env, stdio: "inherit" });
}

export function spawnPnpm(args, env = process.env) {
  const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  return spawn(command, args, { cwd: PROJECT_ROOT, env, stdio: "inherit" });
}
