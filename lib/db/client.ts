/**
 * DB クライアント singleton。
 *
 * 役割:
 * - postgres.js + drizzle インスタンスをアプリ全体で 1 つだけ生成し export する。
 * - Next.js の HMR (dev) 跨ぎでも接続を多重生成しないよう、
 *   `Symbol.for("__FW_SALES_DB__")` を `globalThis` に紐付けて singleton 化する。
 *   (Mock 側 `lib/mock/db.ts` の `__FW_SALES_MOCK_DB__` パターンを踏襲)
 * - 初回 import 時に fire-and-forget で `select 1` を発行し、接続不可の場合は
 *   `process.exit(1)` でプロセスを落とす fail-fast health check を行う。
 *
 * 制約:
 * - `import "server-only"` を必ず付け、Client バンドルへの混入を防ぐ
 *   (Req 6.4)。
 * - postgres.js のオプション `prepare: false` は Supabase Transaction Pooler
 *   との互換のため必須 (PgBouncer が prepared statement を共有できない為)。
 * - `max` は配備環境ごとに `DATABASE_POOL_MAX` で上書きできる。
 *   - Self-host 長期プロセス: 10 程度
 *   - Vercel / serverless: 1 (Pooler が多重化)
 * - 本ファイルは API 表面のみ責務とし、テーブル DDL / 個別クエリは含めない。
 *
 * 関連: design.md §「`lib/db/client.ts`」, requirements.md §1.2 §6.2 §6.4
 */

import "server-only";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
import { assertEnv } from "@/lib/env";

const GLOBAL_KEY = Symbol.for("__FW_SALES_DB__");

type Cached = {
  sql: ReturnType<typeof postgres>;
  db: ReturnType<typeof drizzle<typeof schema>>;
};

const g = globalThis as unknown as { [GLOBAL_KEY]?: Cached };

function buildClient(): Cached {
  const sql = postgres(assertEnv("DATABASE_URL"), {
    // Supabase Transaction Pooler 互換のため `prepare: false` 必須
    prepare: false,
    // 接続プール上限。配備環境別の調整は環境変数で行う
    max: Number(process.env.DATABASE_POOL_MAX ?? "10"),
  });
  const db = drizzle(sql, { schema });
  return { sql, db };
}

const cached: Cached = g[GLOBAL_KEY] ?? (g[GLOBAL_KEY] = buildClient());

export const sql = cached.sql;
export const db = cached.db;
export type DbClient = typeof db;
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// 初回 import 時の fire-and-forget health check (Issue 3 / Option C)。
// 失敗時は console.error の上 `process.exit(1)` で fail-fast。
// テスト環境では process.exit を抑止し、テストランナーごと殺さないようにする
// (design.md Risks 節の指針)。
if (process.env.NODE_ENV !== "test") {
  void sql`select 1`.catch((err) => {
    console.error("[db/client] health check failed:", err);
    process.exit(1);
  });
}
