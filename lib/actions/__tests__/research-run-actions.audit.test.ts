import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResearchItem, StoreResearchRun } from "@/types/research-run";
import { AUDIT_EVENTS } from "@/lib/observability/events";
import { AUDIT_WRITE_WAIT_MS } from "@/lib/observability/audit";

/**
 * AI 調査の起動とレビューの永続監査 (#320)。`store-actions.audit.test.ts` と同じく、
 * 実際の writer・serializer を通し、DB と cache と Workflow 起動だけを mock する。
 */
const mocks = vi.hoisted(() => ({
  session: vi.fn(), insert: vi.fn(), transaction: vi.fn(), revalidateTag: vi.fn(), start: vi.fn(),
  runGetForUpdate: vi.fn(), runUpdate: vi.fn(), storeGetForUpdate: vi.fn(), storeUpdate: vi.fn(),
  storeGet: vi.fn(), getLatestForStore: vi.fn(), create: vi.fn(), runUpdateOutsideTx: vi.fn(),
  runUpdateIfRunning: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ getCurrentSession: mocks.session }));
vi.mock("workflow/api", () => ({ start: mocks.start }));
vi.mock("@/workflows/store-research", () => ({ storeResearchWorkflow: vi.fn() }));
vi.mock("next/cache", () => ({ revalidateTag: mocks.revalidateTag }));
vi.mock("@/lib/repositories", () => ({ repos: {
  store: { get: mocks.storeGet },
  researchRun: {
    getLatestForStore: mocks.getLatestForStore, create: mocks.create, update: mocks.runUpdateOutsideTx,
    // 起動した Workflow run の ID を記録する (#324)。監査の順序には含めない。
    updateIfRunning: mocks.runUpdateIfRunning,
  },
  eventLog: { insert: mocks.insert },
  transaction: mocks.transaction,
} }));

import {
  adoptBulkLaneAction,
  completeReviewAction,
  recordReviewDecisionAction,
  startResearchRunAction,
} from "../research-run-actions";
import { _resetRateLimitForTest } from "@/lib/ai/rate-limiter";

const ACTOR = { userId: "11111111-1111-4111-8111-111111111111", email: "reviewer@example.com" };
const STORE_ID = "store_123";
const RUN_ID = "research_run_1";
const PLACES_FIELD = {
  value: "東京都渋谷区 PRIVATE_OLD_ADDRESS", tier: "A" as const,
  filled_by: "places" as const, updated_at: "2026-09-01T00:00:00.000Z",
};

function item(overrides: Partial<ResearchItem>): ResearchItem {
  return {
    key: "address", research_policy: "FACT", status: "confirmed", value: "PRIVATE_VALUE",
    evidence: "PRIVATE_EVIDENCE", source_ids: [], confidence: null, warning: null, candidates: null,
    ...overrides,
  };
}

const ITEMS: ResearchItem[] = [
  item({ key: "address", value: "東京都港区 PRIVATE_NEW_ADDRESS" }),
  item({ key: "phone", value: "03-1234-5678" }),
  item({ key: "seat_count", value: "20席" }),
  item({ key: "main_target", research_policy: "ANALYSIS", status: "inferred", value: "PRIVATE_TARGET" }),
];

function run(overrides: Partial<StoreResearchRun> = {}): StoreResearchRun {
  return {
    id: RUN_ID, store_id: STORE_ID, requested_by_user_id: null, status: "succeeded", stage: "done",
    result: ITEMS, source_registry: [], review_decisions: {}, review_completed_at: null,
    token_usage: null, warnings: [], error_kind: null, error_message: null,
    started_at: "2026-10-10T00:00:00.000Z", expires_at: "2026-10-10T00:10:00.000Z",
    finished_at: "2026-10-10T00:03:00.000Z",
    ...overrides,
  };
}

let order: string[];
const tx = () => ({
  researchRun: { getForUpdate: mocks.runGetForUpdate, update: mocks.runUpdate },
  store: { getForUpdate: mocks.storeGetForUpdate, update: mocks.storeUpdate },
});
/** payload に店舗情報の値・根拠の文言が入っていないこと。 */
function expectNoStoreValues() {
  expect(JSON.stringify(mocks.insert.mock.calls)).not.toMatch(/PRIVATE|03-1234|20席|東京都|渋谷|港区/);
}

beforeEach(() => {
  vi.resetAllMocks();
  _resetRateLimitForTest();
  order = [];
  mocks.session.mockResolvedValue(ACTOR);
  mocks.runGetForUpdate.mockImplementation(async () => { order.push("lock"); return run(); });
  mocks.runUpdate.mockImplementation(async () => { order.push("run-update"); return {}; });
  mocks.storeGetForUpdate.mockImplementation(async () => {
    order.push("store-lock");
    return { id: STORE_ID, stage: "未調査", basic_info: { address: PLACES_FIELD } };
  });
  mocks.storeUpdate.mockImplementation(async () => { order.push("store-update"); return {}; });
  mocks.transaction.mockImplementation(async (fn: (repos: unknown) => Promise<unknown>) => {
    const result = await fn(tx());
    order.push("commit");
    return result;
  });
  mocks.insert.mockImplementation(async () => { order.push("audit"); });
  mocks.revalidateTag.mockImplementation(() => { order.push("cache"); });
  mocks.storeGet.mockResolvedValue({ id: STORE_ID, stage: "未調査", basic_info: {} });
  mocks.getLatestForStore.mockResolvedValue(null);
  mocks.create.mockImplementation(async () => { order.push("create"); return { id: RUN_ID }; });
  mocks.start.mockImplementation(async () => { order.push("workflow"); return { runId: "wrun_1" }; });
  mocks.runUpdateOutsideTx.mockResolvedValue({});
  mocks.runUpdateIfRunning.mockResolvedValue({});
  // 開始前の実行条件チェック (#324) を通すため、AI の API キーがある環境にする。
  vi.stubEnv("GEMINI_API_KEY", "test-key");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const RUN_TARGET = {
  kind: "mutation", level: "info", error: null,
  actor_user_id: ACTOR.userId, actor_email: ACTOR.email,
  target_type: "research_run", target_id: RUN_ID, store_id: STORE_ID,
};

describe("recordReviewDecisionAction persistent audit", () => {
  const decide = (overrides: Partial<Parameters<typeof recordReviewDecisionAction>[0]> = {}) =>
    recordReviewDecisionAction({ runId: RUN_ID, storeId: STORE_ID, itemKey: "phone", decision: "adopted", ...overrides });

  it("records a new adoption once after commit, with the session actor and run, and no value", async () => {
    const result = await decide();
    expect(result.ok).toBe(true);
    expect(mocks.insert).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      ...RUN_TARGET, event: AUDIT_EVENTS.researchReviewDecide,
      payload: { itemKey: "phone", decision: "adopted", effect: "new", overwrittenOrigin: null, edited: false },
    }));
    expectNoStoreValues();
    expect(order).toEqual(["lock", "store-lock", "store-update", "run-update", "commit", "audit", "cache"]);
  });

  it("records an overwrite and where the replaced value came from, never the replaced value", async () => {
    expect((await decide({ itemKey: "address" })).ok).toBe(true);
    expect(mocks.insert.mock.calls[0]![0].payload).toEqual({
      itemKey: "address", decision: "adopted", effect: "overwrite", overwrittenOrigin: "places", edited: false,
    });
    expectNoStoreValues();
  });

  it("records an adoption that left the basic info unchanged as `same` (no store write)", async () => {
    mocks.storeGetForUpdate.mockResolvedValue({
      id: STORE_ID, stage: "未調査", basic_info: { phone: { ...PLACES_FIELD, value: "03-1234-5678" } },
    });
    expect((await decide()).ok).toBe(true);
    expect(mocks.storeUpdate).not.toHaveBeenCalled();
    expect(mocks.insert.mock.calls[0]![0].payload).toMatchObject({ effect: "same", overwrittenOrigin: null });
  });

  it("marks an edited adoption without recording the typed value", async () => {
    expect((await decide({ editedValue: "PRIVATE_TYPED_PHONE" })).ok).toBe(true);
    expect(mocks.insert.mock.calls[0]![0].payload).toMatchObject({ effect: "new", edited: true });
    expectNoStoreValues();
  });

  it.each(["rejected", "skipped"] as const)("records a %s decision with the item key only", async (decision) => {
    expect((await decide({ decision })).ok).toBe(true);
    expect(mocks.insert).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      ...RUN_TARGET, event: AUDIT_EVENTS.researchReviewDecide, payload: { itemKey: "phone", decision },
    }));
    expect(order).toEqual(["lock", "run-update", "commit", "audit", "cache"]);
  });

  it("takes the actor from the server session, not from extra client fields", async () => {
    const spoofed = { actor: { userId: "22222222-2222-4222-8222-222222222222", email: "spoof@example.com" } };
    await decide(spoofed as never);
    expect(JSON.stringify(mocks.insert.mock.calls)).not.toMatch(/spoof@example|22222222/);
    expect(mocks.insert.mock.calls[0]![0]).toMatchObject({ actor_user_id: ACTOR.userId });
  });

  it.each([
    ["already decided", () => run({ review_decisions: { phone: { decision: "skipped", decided_at: "x" } } })],
    ["completed review", () => run({ review_completed_at: "2026-10-10T01:00:00.000Z" })],
    ["another store's run", () => run({ store_id: "store_other" })],
    ["missing run", () => null],
  ])("does not audit or revalidate a refused decision (%s)", async (_label, makeRun) => {
    mocks.runGetForUpdate.mockResolvedValue(makeRun());
    expect((await decide()).ok).toBe(false);
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
  });

  it("does not audit when the transaction fails after its callback (rollback/commit failure)", async () => {
    mocks.transaction.mockImplementation(async (fn: (repos: unknown) => Promise<unknown>) => {
      await fn(tx());
      expect(mocks.insert).not.toHaveBeenCalled();
      throw new Error("transaction rolled back");
    });
    await expect(decide()).rejects.toThrow("transaction rolled back");
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
  });

  it("keeps the decision successful when the audit insert fails", async () => {
    mocks.insert.mockRejectedValue(new Error("audit database failed"));
    const result = await decide();
    expect(result.ok).toBe(true);
    expect(mocks.runUpdate).toHaveBeenCalledOnce();
    expect(mocks.revalidateTag).toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledOnce();
    expect(JSON.parse(vi.mocked(console.error).mock.calls[0]![0]).event).toBe("audit.write_failed");
  });

  it("continues to cache and success after a pending audit reaches its wait bound", async () => {
    vi.useFakeTimers();
    mocks.insert.mockImplementation(() => new Promise<void>(() => undefined));
    const pending = decide();
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toContain("commit");
    expect(mocks.insert).toHaveBeenCalledOnce();
    expect(mocks.revalidateTag).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(AUDIT_WRITE_WAIT_MS);
    expect((await pending).ok).toBe(true);
    expect(mocks.revalidateTag).toHaveBeenCalled();
    expect(JSON.parse(vi.mocked(console.error).mock.calls[0]![0]).event).toBe("audit.write_timed_out");
  });
});

describe("completeReviewAction persistent audit", () => {
  const complete = (skipRemaining: boolean) =>
    completeReviewAction({ runId: RUN_ID, storeId: STORE_ID, skipRemaining });
  const decided = {
    address: { decision: "adopted" as const, decided_at: "t" },
    phone: { decision: "rejected" as const, decided_at: "t" },
  };

  it("records skip-remaining completion with the breakdown and stage change after commit", async () => {
    mocks.runGetForUpdate.mockImplementation(async () => { order.push("lock"); return run({ review_decisions: decided }); });
    expect((await complete(true)).ok).toBe(true);
    expect(mocks.insert).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      ...RUN_TARGET, event: AUDIT_EVENTS.researchReviewComplete,
      payload: {
        method: "skip_remaining", adoptedCount: 1, rejectedCount: 1, skippedCount: 2,
        autoSkippedCount: 2, stageAdvanced: true,
      },
    }));
    expect(order).toEqual(["lock", "run-update", "store-lock", "store-update", "commit", "audit", "cache", "cache"]);
  });

  it("records an all-decided completion that does not demote an already researched store", async () => {
    mocks.runGetForUpdate.mockResolvedValue(run({ review_decisions: {
      ...decided,
      seat_count: { decision: "skipped", decided_at: "t" },
      main_target: { decision: "adopted", decided_at: "t" },
    } }));
    mocks.storeGetForUpdate.mockResolvedValue({ id: STORE_ID, stage: "架電済み", basic_info: {} });
    expect((await complete(false)).ok).toBe(true);
    expect(mocks.insert.mock.calls[0]![0].payload).toEqual({
      method: "all_decided", adoptedCount: 2, rejectedCount: 1, skippedCount: 1,
      autoSkippedCount: 0, stageAdvanced: false,
    });
  });

  it("does not audit a refused completion (undecided items without skipRemaining)", async () => {
    expect((await complete(false)).ok).toBe(false);
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
  });

  it("keeps the completion successful when the audit insert fails", async () => {
    mocks.insert.mockRejectedValue(new Error("audit offline"));
    expect((await complete(true)).ok).toBe(true);
    expect(mocks.revalidateTag).toHaveBeenCalledTimes(2);
    expect(JSON.parse(vi.mocked(console.error).mock.calls[0]![0]).event).toBe("audit.write_failed");
  });
});

describe("adoptBulkLaneAction persistent audit", () => {
  const bulk = (complete: boolean, expectedKeys = ["phone", "seat_count"]) =>
    adoptBulkLaneAction({ runId: RUN_ID, storeId: STORE_ID, expectedKeys, complete });

  it("records one bulk adoption with item keys and effect counts, and no completion row", async () => {
    mocks.storeGetForUpdate.mockResolvedValue({
      id: STORE_ID, stage: "未調査", basic_info: { address: PLACES_FIELD, seat_count: { ...PLACES_FIELD, value: "２０席" } },
    });
    expect((await bulk(false)).ok).toBe(true);
    expect(mocks.insert).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      ...RUN_TARGET, event: AUDIT_EVENTS.researchReviewBulkAdopt,
      payload: { itemKeys: ["phone", "seat_count"], effectCounts: { new: 1, same: 1, overwrite: 0 } },
    }));
    expectNoStoreValues();
  });

  it("records the bulk adoption and the completion, both after commit and before cache", async () => {
    // address (上書き) と main_target (推定) は 1 件ずつの判断が必要なため、先に判断済みにする。
    mocks.runGetForUpdate.mockImplementation(async () => {
      order.push("lock");
      return run({ review_decisions: {
        address: { decision: "rejected", decided_at: "t" },
        main_target: { decision: "skipped", decided_at: "t" },
      } });
    });
    expect((await bulk(true)).ok).toBe(true);
    expect(mocks.insert).toHaveBeenCalledTimes(2);
    const events = mocks.insert.mock.calls.map(([row]) => row);
    expect(events).toEqual([
      expect.objectContaining({ ...RUN_TARGET, event: AUDIT_EVENTS.researchReviewBulkAdopt }),
      expect.objectContaining({
        ...RUN_TARGET, event: AUDIT_EVENTS.researchReviewComplete,
        payload: {
          method: "adopt_bulk", adoptedCount: 2, rejectedCount: 1, skippedCount: 1,
          autoSkippedCount: 0, stageAdvanced: true,
        },
      }),
    ]);
    expect(order).toEqual(["lock", "store-lock", "store-update", "run-update", "commit", "audit", "audit", "cache", "cache"]);
  });

  it("does not audit when the screen and server disagree (nothing is written)", async () => {
    expect((await bulk(false, ["phone", "address"])).ok).toBe(false);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("keeps the bulk adoption successful when both audit inserts fail", async () => {
    mocks.runGetForUpdate.mockResolvedValue(run({ review_decisions: {
      address: { decision: "rejected", decided_at: "t" },
      main_target: { decision: "skipped", decided_at: "t" },
    } }));
    mocks.insert.mockRejectedValue(new Error("audit offline"));
    const result = await bulk(true);
    expect(result.ok).toBe(true);
    expect(mocks.revalidateTag).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledTimes(2);
  });

  it("continues after both pending audits reach their wait bounds", async () => {
    vi.useFakeTimers();
    mocks.runGetForUpdate.mockResolvedValue(run({ review_decisions: {
      address: { decision: "rejected", decided_at: "t" },
      main_target: { decision: "skipped", decided_at: "t" },
    } }));
    mocks.insert.mockImplementation(() => new Promise<void>(() => undefined));
    let settled = false;
    const pending = bulk(true).then((result) => { settled = true; return result; });
    await vi.advanceTimersByTimeAsync(AUDIT_WRITE_WAIT_MS);
    expect(settled).toBe(false);
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(AUDIT_WRITE_WAIT_MS);
    expect((await pending).ok).toBe(true);
    expect(mocks.insert).toHaveBeenCalledTimes(2);
    expect(mocks.revalidateTag).toHaveBeenCalledTimes(2);
  });
});

describe("startResearchRunAction persistent audit", () => {
  it("does not create a run or an audit row when AI research cannot run here (#324)", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    expect((await startResearchRunAction(STORE_ID)).ok).toBe(false);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("records the started run after the workflow is enqueued", async () => {
    expect((await startResearchRunAction(STORE_ID)).ok).toBe(true);
    expect(mocks.insert).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      ...RUN_TARGET, event: AUDIT_EVENTS.researchRunStart, payload: { stuckRunFailedId: null },
    }));
    expect(order).toEqual(["create", "workflow", "audit", "cache"]);
  });

  it("records which stuck run was failed before starting again", async () => {
    mocks.getLatestForStore.mockResolvedValue({
      id: "research_run_stuck", store_id: STORE_ID, status: "running", expires_at: "2000-01-01T00:00:00.000Z",
    });
    expect((await startResearchRunAction(STORE_ID)).ok).toBe(true);
    expect(mocks.insert.mock.calls[0]![0].payload).toEqual({ stuckRunFailedId: "research_run_stuck" });
  });

  it("does not audit when the workflow could not be started", async () => {
    mocks.start.mockRejectedValue(new Error("enqueue failed"));
    expect((await startResearchRunAction(STORE_ID)).ok).toBe(false);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("keeps the started run when the audit insert fails", async () => {
    mocks.insert.mockRejectedValue(new Error("audit offline"));
    expect((await startResearchRunAction(STORE_ID)).ok).toBe(true);
    expect(mocks.revalidateTag).toHaveBeenCalled();
    expect(JSON.parse(vi.mocked(console.error).mock.calls[0]![0]).event).toBe("audit.write_failed");
  });
});
