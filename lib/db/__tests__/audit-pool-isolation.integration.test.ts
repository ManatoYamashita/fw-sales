/**
 * 実 PostgreSQL に対する監査書込みの隔離 regression test (PR #282 friend review P1)。
 *
 * 証明したい性質:
 * - 監査 INSERT が DB 側で停滞しても、業務 DB プールの接続を奪わない。
 * - 監査 query は DB 側で有界であり、停滞後に監査プールが復帰する。
 * - 監査の失敗は呼び出し元へ throw されない。
 *
 * mock DB では上記のいずれも証明できないため、本ファイルだけは実接続を使う。
 * 既定の Vitest job (`USE_MOCK_DB=true`) では `AUDIT_DB_INTEGRATION` が無く skip され、
 * CI の専用 job `Audit DB integration` (postgres:15-alpine service) でのみ走る。
 *
 * 決定論: 待ち時間を祈る sleep ではなく `LOCK TABLE ... IN EXCLUSIVE MODE` で
 * INSERT を確実にブロックする (EXCLUSIVE は INSERT の ROW EXCLUSIVE と競合する)。
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { AUDIT_EVENTS, type AuditInput } from "@/lib/observability/events";

const ENABLED = process.env.AUDIT_DB_INTEGRATION === "1";

/** 監査が停滞した状態でも業務 query はこの時間内に返らなければならない。 */
const BUSINESS_QUERY_BUDGET_MS = 2_000;
/** テスト自体が CI を hang させないための hard timeout。 */
const HARD_TIMEOUT_MS = 15_000;
/** Vitest 既定の 5 秒より長く取り、hard timeout の方が先に働くようにする。 */
const TEST_TIMEOUT_MS = 40_000;

const ACTOR = { userId: "11111111-1111-4111-8111-111111111111", email: "actor@example.com" };

function auditInput(storeId: string): AuditInput {
  return {
    event: AUDIT_EVENTS.salesProgressUpdate,
    actor: ACTOR,
    storeId,
    payload: { changedFields: ["memo"] },
  };
}

/** 待機が永久に終わらない場合でもテストを失敗させて次へ進める。 */
function withHardTimeout<T>(work: PromiseLike<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${message} (>${ms}ms)`)), ms);
    work.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error); },
    );
  });
}

describe.skipIf(!ENABLED)("audit writes against a real PostgreSQL pool", () => {
  let writeAudit: (input: AuditInput) => Promise<void>;
  let businessSql: ReturnType<typeof postgres>;
  let auditSql: ReturnType<typeof postgres>;
  let admin: ReturnType<typeof postgres>;
  let databaseUrl: string;

  beforeAll(async () => {
    databaseUrl = process.env.DATABASE_URL ?? "";
    expect(databaseUrl, "DATABASE_URL must point at the integration database").not.toBe("");

    // max=1 でなければ「監査がプールを奪う」状況を再現できず、テストが無意味に PASS する。
    expect(
      process.env.DATABASE_POOL_MAX,
      "DATABASE_POOL_MAX must be 1 so the business pool has a single connection",
    ).toBe("1");

    // 動的 import: skip 時に DB クライアントを構築しないため。
    ({ writeAudit } = await import("@/lib/observability/audit"));
    ({ sql: businessSql } = await import("@/lib/db/client"));
    ({ auditSql } = await import("@/lib/db/audit-client"));

    admin = postgres(databaseUrl, { prepare: false, max: 2 });
  });

  afterAll(async () => {
    await Promise.allSettled([
      admin?.end({ timeout: 5 }),
      businessSql?.end({ timeout: 5 }),
      auditSql?.end({ timeout: 5 }),
    ]);
  });

  beforeEach(async () => {
    await admin`delete from event_logs`;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** event_logs への INSERT を決定論的にブロックした状態で `fn` を走らせる。 */
  async function withEventLogsLocked<T>(fn: () => Promise<T>): Promise<T> {
    const blocker = postgres(databaseUrl, { prepare: false, max: 1 });
    let release!: () => void;
    const released = new Promise<void>((resolve) => { release = resolve; });
    let locked!: () => void;
    const acquired = new Promise<void>((resolve) => { locked = resolve; });

    const held = blocker.begin(async (tx) => {
      await tx`lock table event_logs in exclusive mode`;
      locked();
      await released;
    });

    try {
      await withHardTimeout(acquired, HARD_TIMEOUT_MS, "could not acquire the blocking lock");
      return await fn();
    } finally {
      // 失敗時も必ず lock を解放し、接続を閉じて CI にリソースを残さない。
      release();
      await held.catch(() => undefined);
      await blocker.end({ timeout: 5 }).catch(() => undefined);
    }
  }

  it("TEST 1: persists an audit event through the dedicated pool", async () => {
    await withHardTimeout(writeAudit(auditInput("store_normal")), HARD_TIMEOUT_MS, "normal audit write hung");

    const rows = await admin<{ event: string; actor_email: string; payload: unknown; store_id: string }[]>`
      select event, actor_email, payload, store_id from event_logs where store_id = 'store_normal'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      event: AUDIT_EVENTS.salesProgressUpdate,
      actor_email: ACTOR.email,
      store_id: "store_normal",
      payload: { changedFields: ["memo"] },
    });
    expect(console.error).not.toHaveBeenCalled();
  }, TEST_TIMEOUT_MS);

  it("TEST 2: a blocked audit INSERT does not starve the business pool", async () => {
    await withEventLogsLocked(async () => {
      const auditStartedAt = Date.now();
      let auditSettled = false;
      const auditWrite = writeAudit(auditInput("store_blocked"))
        .finally(() => { auditSettled = true; });

      // 監査 write が未完了である間ずっと、業務 query を流し続けて計測する。
      // 「停滞中の一瞬」を捉えにいく polling だと DB 側 timeout との競争になり
      // flaky になるため、停滞している期間全体を対象にする。
      let slowestBusinessMs = 0;
      let samples = 0;
      while (!auditSettled) {
        const startedAt = Date.now();
        const [row] = await withHardTimeout(
          businessSql<{ ok: number }[]>`select 1 as ok`,
          BUSINESS_QUERY_BUDGET_MS,
          "business query was starved by the blocked audit INSERT",
        );
        expect(row!.ok).toBe(1);
        slowestBusinessMs = Math.max(slowestBusinessMs, Date.now() - startedAt);
        samples += 1;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      const auditElapsedMs = Date.now() - auditStartedAt;

      // 監査側は業務へ throw しない (TEST 4 の契約)。
      await expect(
        withHardTimeout(auditWrite, HARD_TIMEOUT_MS, "audit write never returned"),
      ).resolves.toBeUndefined();

      // 監査が実際に停滞していたこと。ここが短いとテストが素通りしてしまう。
      expect(auditElapsedMs).toBeGreaterThanOrEqual(500);
      // その停滞中も業務 query を複数回完走できていること。
      expect(samples).toBeGreaterThan(1);
      expect(slowestBusinessMs).toBeLessThan(BUSINESS_QUERY_BUDGET_MS);
    });
  }, TEST_TIMEOUT_MS);

  it("TEST 3: the audit pool is bounded and recovers after the stall", async () => {
    await withEventLogsLocked(async () => {
      await withHardTimeout(
        writeAudit(auditInput("store_bounded")),
        HARD_TIMEOUT_MS,
        "audit write never returned while blocked",
      );

      // 監査プールの唯一の接続が解放されていること (statement_timeout による中断)。
      const [row] = await withHardTimeout(
        auditSql<{ ok: number }[]>`select 1 as ok`,
        BUSINESS_QUERY_BUDGET_MS,
        "audit pool connection was still held after the stall",
      );
      expect(row!.ok).toBe(1);
    });

    // ブロック解除後、次の監査書込みが正常に永続化できる。
    await withHardTimeout(
      writeAudit(auditInput("store_recovered")),
      HARD_TIMEOUT_MS,
      "audit write hung after recovery",
    );
    const rows = await admin`select store_id from event_logs where store_id = 'store_recovered'`;
    expect(rows).toHaveLength(1);
  }, TEST_TIMEOUT_MS);

  it("TEST 4: a failed audit write never becomes a business failure", async () => {
    await withEventLogsLocked(async () => {
      await expect(
        withHardTimeout(writeAudit(auditInput("store_failed")), HARD_TIMEOUT_MS, "audit write never returned"),
      ).resolves.toBeUndefined();
    });

    // 中断された INSERT は永続化されない。console fallback のみ。
    const rows = await admin`select store_id from event_logs where store_id = 'store_failed'`;
    expect(rows).toHaveLength(0);
    expect(console.error).toHaveBeenCalled();
  }, TEST_TIMEOUT_MS);
});
