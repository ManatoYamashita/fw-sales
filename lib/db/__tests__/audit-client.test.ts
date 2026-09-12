/**
 * 監査専用 DB クライアントの構成契約 (PR #282 friend review P1)。
 *
 * ここでは「設定が意図どおりか」だけを検証する。実際に業務プールを奪わないことの
 * 証明は実 PostgreSQL が要るため `audit-pool-isolation.integration.test.ts` が担う。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { AUDIT_WRITE_WAIT_MS } from "@/lib/observability/audit";

const GLOBAL_KEY = Symbol.for("__FW_SALES_AUDIT_DB__");
const BUSINESS_GLOBAL_KEY = Symbol.for("__FW_SALES_DB__");
const DUMMY_URL = "postgresql://user:pass@localhost:5432/dummy";

type Loaded = {
  auditSql: { options: Record<string, unknown>; end: () => Promise<void> };
  AUDIT_DB_STATEMENT_TIMEOUT_MS: number;
};

const opened: Loaded["auditSql"][] = [];

/** singleton は globalThis に載るため、env を変える各ケースで捨ててから読み直す。 */
async function loadAuditClient(timeoutEnv?: string): Promise<Loaded> {
  delete (globalThis as Record<symbol, unknown>)[GLOBAL_KEY];
  vi.resetModules();
  vi.stubEnv("DATABASE_URL", DUMMY_URL);
  if (timeoutEnv === undefined) {
    vi.stubEnv("AUDIT_DB_STATEMENT_TIMEOUT_MS", "");
  } else {
    vi.stubEnv("AUDIT_DB_STATEMENT_TIMEOUT_MS", timeoutEnv);
  }
  const loaded = (await import("../audit-client")) as unknown as Loaded;
  opened.push(loaded.auditSql);
  return loaded;
}

afterEach(async () => {
  await Promise.allSettled(opened.splice(0).map((sql) => sql.end()));
  delete (globalThis as Record<symbol, unknown>)[GLOBAL_KEY];
  // 本ファイルが作った業務クライアントの singleton を他ファイルへ持ち越さない
  // (いずれも接続は張られていない。`end()` はせず破棄のみ)。
  delete (globalThis as Record<symbol, unknown>)[BUSINESS_GLOBAL_KEY];
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("dedicated audit DB client", () => {
  it("uses its own single-connection pool, not the business pool", async () => {
    const { auditSql } = await loadAuditClient();
    const { sql: businessSql } = (await import("../client")) as unknown as { sql: unknown };

    expect(auditSql).not.toBe(businessSql);
    // 監査が停滞しても奪えるのは自分の 1 接続だけ。
    expect(auditSql.options.max).toBe(1);
    // Supabase Transaction Pooler 互換 (業務プールと同条件)
    expect(auditSql.options.prepare).toBe(false);
    // 運用で業務接続と区別できるようにする
    expect(auditSql.options.connection).toMatchObject({ application_name: "fw-sales-audit" });
  });

  it("bounds the audit query in the database, shorter than the caller's wait", async () => {
    const { auditSql, AUDIT_DB_STATEMENT_TIMEOUT_MS } = await loadAuditClient();

    expect(AUDIT_DB_STATEMENT_TIMEOUT_MS).toBe(1_000);
    expect(auditSql.options.connection).toMatchObject({
      statement_timeout: AUDIT_DB_STATEMENT_TIMEOUT_MS,
    });
    // DB 側が先に settle することで writer は結果を確定でき、接続も解放される。
    expect(AUDIT_DB_STATEMENT_TIMEOUT_MS).toBeLessThan(AUDIT_WRITE_WAIT_MS);
  });

  it("allows disabling the DB-side bound for a pooler that rejects the parameter", async () => {
    const { auditSql, AUDIT_DB_STATEMENT_TIMEOUT_MS } = await loadAuditClient("0");

    expect(AUDIT_DB_STATEMENT_TIMEOUT_MS).toBe(0);
    expect(auditSql.options.connection).not.toHaveProperty("statement_timeout");
    // 退避経路でも application_name と専用プール隔離は残る。
    expect(auditSql.options.connection).toMatchObject({ application_name: "fw-sales-audit" });
    expect(auditSql.options.max).toBe(1);
  });

  it.each(["abc", "-1", "1.5"])(
    "falls back to the default instead of breaking the connection on %s",
    async (value) => {
      const { auditSql, AUDIT_DB_STATEMENT_TIMEOUT_MS } = await loadAuditClient(value);

      expect(AUDIT_DB_STATEMENT_TIMEOUT_MS).toBe(1_000);
      expect(auditSql.options.connection).toMatchObject({ statement_timeout: 1_000 });
    },
  );
});
