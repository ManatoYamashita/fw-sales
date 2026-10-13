import { execFileSync } from "node:child_process";

/**
 * E2E 用 DB の接続先。`scripts/e2e-local.mjs` の `getE2eDatabaseEnv` と同じ解決順。
 * Playwright は spec を CommonJS に変換するため、`import.meta` を使う同ファイルは読み込めない。
 */
export function e2eDatabaseUrl(): string {
  if (process.env.E2E_DATABASE_URL) return process.env.E2E_DATABASE_URL;
  const name = process.env.E2E_DB_CONTAINER?.trim() || "fw-sales-e2e-postgres";
  const containers = JSON.parse(
    execFileSync("container", ["list", "--all", "--format", "json"], { encoding: "utf8" }),
  ) as Array<{ id: string; status?: { networks?: Array<{ ipv4Address?: string }> } }>;
  const address = containers.find((c) => c.id === name)?.status?.networks?.[0]?.ipv4Address;
  if (!address) throw new Error(`E2E用PostgreSQLコンテナ「${name}」の内部IPを取得できませんでした。`);
  return `postgres://postgres:postgres@${address.split("/")[0]}:5432/postgres`;
}
