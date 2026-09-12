/**
 * 監査ログ (`event_logs`) 専用 DB クライアント singleton。
 *
 * ## なぜ業務プールと分けるのか (PR #282 friend review P1)
 *
 * 監査書込みは「業務 commit 後の best-effort」であり、**業務処理を妨げないこと**が
 * 中核要件である。しかし監査が業務と同じ `lib/db/client.ts` のプールを共有していると、
 * 次の波及が起きる:
 *
 *   業務 commit → 監査 INSERT が lock 待ち / DB 停滞
 *   → JS 側は `AUDIT_WRITE_WAIT_MS` で待機を打ち切るが query は生きたまま
 *   → その接続は監査 INSERT が保持し続ける
 *   → `DATABASE_POOL_MAX=1` (Vercel / serverless 想定) では空き接続が無くなる
 *   → 次の**通常業務 query** が接続を取れず詰まる
 *
 * つまり監査障害が業務障害へ昇格する。これを物理的に断つため、監査は専用プールを持つ。
 * 実 PostgreSQL + `DATABASE_POOL_MAX=1` での回帰テストは
 * `lib/db/__tests__/audit-pool-isolation.integration.test.ts`。
 *
 * ## 監査プール自身を有界にする方法
 *
 * 専用プールだけでは「監査プールが永久に占有される」可能性が残るため、DB 側の
 * `statement_timeout` を startup connection parameter として**監査接続にのみ**与える。
 * これにより lock 待ちを含む query 全体が DB 側で中断され (`57014`)、接続が解放される。
 *
 * `postgres.js` の `PendingQuery.cancel()` は採用しない。3.4.9 の実装は
 * `cancel() { return this.canceller && (this.canceller(this), this.canceller = null) }`
 * で内部 promise を捨てるため呼び出し側から rejection を consume できず、cancel 用
 * socket が `ECONNRESET` になると **unhandled rejection** としてプロセスを落とし得る
 * (本 PR で実 PostgreSQL に対し再現確認済み)。監査の保険が業務停止を招いては本末転倒。
 *
 * ## 制約
 *
 * - `import "server-only"` 必須 (`./client` と同じ理由)。
 * - `prepare: false` は Supabase Transaction Pooler (PgBouncer transaction mode) 互換のため必須。
 * - 明示 transaction + `SET LOCAL` は使わない。`lib/db/store-repository.ts` に記録のとおり
 *   Transaction Pooler と非互換で `UNSAFE_TRANSACTION` を誘発した経緯がある。同ファイルが
 *   「statement_timeout の制御は別ルート (postgres-js の connection 設定 …) で扱う」と
 *   したその別ルートが本ファイルである。
 * - `DATABASE_URL` は業務側と同じ値を使う。監査専用の credential は増やさない。
 * - `max: 1` + `idle_timeout` で、増える接続数を最小限に保つ。
 * - `./client` と異なり import 時の health check / `process.exit(1)` は**行わない**。
 *   監査の到達性で業務プロセスを落とさない。
 *
 * 関連: docs/observability-runbook.md, lib/observability/audit.ts
 */

import "server-only";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
import { assertEnv, readEnv } from "@/lib/env";

const GLOBAL_KEY = Symbol.for("__FW_SALES_AUDIT_DB__");

/**
 * 監査接続の既定 `statement_timeout` (ms)。
 *
 * `AUDIT_WRITE_WAIT_MS` (1500ms, caller 側の待機上限) より**短く**する。DB が先に
 * 57014 で settle することで、writer は「結果不明のまま放置」ではなく失敗を確定して
 * fallback でき、接続もその時点で解放される。1500ms との差 500ms は round-trip の余裕。
 *
 * `AUDIT_DB_STATEMENT_TIMEOUT_MS=0` で無効化できる。これは新しい秘密情報ではなく、
 * startup parameter を受け付けない pooler 構成に当たった場合の退避経路である
 * (その場合も `AUDIT_WRITE_WAIT_MS` の外側境界と専用プール隔離は残る)。
 */
export const AUDIT_DB_STATEMENT_TIMEOUT_MS = readAuditStatementTimeoutMs();

function readAuditStatementTimeoutMs(): number {
  const raw = readEnv("AUDIT_DB_STATEMENT_TIMEOUT_MS");
  if (raw === undefined) return 1_000;
  const parsed = Number(raw);
  // 不正値で監査接続を壊さない。既定へ戻す。
  if (!Number.isInteger(parsed) || parsed < 0) return 1_000;
  return parsed;
}

type Cached = {
  sql: ReturnType<typeof postgres>;
  db: ReturnType<typeof drizzle<typeof schema>>;
};

const g = globalThis as unknown as { [GLOBAL_KEY]?: Cached };

function buildAuditClient(): Cached {
  const sql = postgres(assertEnv("DATABASE_URL"), {
    // Supabase Transaction Pooler 互換 (業務プールと同条件)
    prepare: false,
    // 監査は mutation 1 件につき INSERT 1 回。1 接続で足り、増設分を最小化する
    max: 1,
    // idle 接続を抱え続けない (serverless / pooler の接続数圧を下げる)
    idle_timeout: 20,
    connection: {
      // 運用で業務接続と区別できるようにする (PgBouncer も転送する標準 startup parameter)
      application_name: "fw-sales-audit",
      ...(AUDIT_DB_STATEMENT_TIMEOUT_MS > 0
        ? { statement_timeout: AUDIT_DB_STATEMENT_TIMEOUT_MS }
        : {}),
    },
  });
  return { sql, db: drizzle(sql, { schema }) };
}

const cached: Cached = g[GLOBAL_KEY] ?? (g[GLOBAL_KEY] = buildAuditClient());

/** 監査専用の postgres.js プール。業務 `sql` とは別インスタンス。 */
export const auditSql = cached.sql;
/** 監査専用の Drizzle executor。`event_logs` の append にのみ使う。 */
export const auditDb = cached.db;
