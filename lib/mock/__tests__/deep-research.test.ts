/**
 * `mockDeepResearchRepo` の単体テスト (deep-research-pipeline spec, Issue #43,
 * Tasks 1.3 + 6.1 で網羅)
 *
 * カバレッジ (7 ケース):
 * 1. insertJob → findActiveByStore で進行中ジョブを引ける
 * 2. 状態遷移 (queued → researching → done) を updateJobStatus で行える
 * 3. claimOldestQueued は最古の queued を 1 件返す (FIFO)
 * 4. countInFlight は researching + structuring の合計
 * 5. findStuckJobs は research_started_at が閾値より古い in-flight を返す
 * 6. countByUserSinceDay は閾値以降の当該ユーザージョブのみ集計 (Task 6.1)
 * 7. countByMonth は yearMonthJST 接頭辞一致で集計 (Task 6.1)
 *
 * 関連: requirements.md §1.2, §2.3, §5.4, §5.5, §6.1, §6.2, §8.3
 */

import { describe, expect, it, beforeEach } from "vitest";
import { mockDeepResearchRepo } from "../deep-research";
import { mockDb } from "../db";
import type { DeepResearchJob } from "@/types/deep-research";

const USER_A = "00000000-0000-0000-0000-0000000000aa";
const STORE_1 = "store_001";
const STORE_2 = "store_002";

function seedJob(overrides: Partial<DeepResearchJob>): DeepResearchJob {
  const base: DeepResearchJob = {
    id: `job_${Math.random().toString(36).slice(2, 8)}`,
    store_id: STORE_1,
    user_id: USER_A,
    status: "queued",
    deep_research_task_id: null,
    attempts: 0,
    error_log: null,
    enqueued_at: new Date().toISOString(),
    research_started_at: null,
    research_completed_at: null,
    completed_at: null,
    ...overrides,
  };
  mockDb.deepResearchJobs.set(base.id, base);
  return base;
}

describe("mockDeepResearchRepo", () => {
  beforeEach(() => {
    mockDb.deepResearchJobs.clear();
    mockDb.deepResearchReports.clear();
  });

  it("insertJob → findActiveByStore で進行中ジョブを引ける、done は除外", async () => {
    const job = await mockDeepResearchRepo.insertJob({
      store_id: STORE_1,
      user_id: USER_A,
    });
    expect(job.status).toBe("queued");

    const active = await mockDeepResearchRepo.findActiveByStore(STORE_1);
    expect(active?.id).toBe(job.id);

    // 同じ store_id で done になれば active から除外される
    await mockDeepResearchRepo.updateJobStatus(job.id, { status: "done" });
    const afterDone = await mockDeepResearchRepo.findActiveByStore(STORE_1);
    expect(afterDone).toBeNull();
  });

  it("updateJobStatus で queued → researching → done と遷移できる", async () => {
    const job = await mockDeepResearchRepo.insertJob({
      store_id: STORE_1,
      user_id: USER_A,
    });
    const startedAt = new Date().toISOString();
    const r1 = await mockDeepResearchRepo.updateJobStatus(job.id, {
      status: "researching",
      deep_research_task_id: "interactions/abc",
      attempts: 1,
      research_started_at: startedAt,
    });
    expect(r1.status).toBe("researching");
    expect(r1.deep_research_task_id).toBe("interactions/abc");
    expect(r1.research_started_at).toBe(startedAt);

    const r2 = await mockDeepResearchRepo.updateJobStatus(job.id, {
      status: "done",
      completed_at: new Date().toISOString(),
    });
    expect(r2.status).toBe("done");
    expect(r2.deep_research_task_id).toBe("interactions/abc"); // 残存確認
  });

  it("claimOldestQueued: 最古の queued を 1 件返す (FIFO)", async () => {
    const older = seedJob({
      enqueued_at: "2026-05-17T01:00:00.000Z",
      status: "queued",
    });
    seedJob({
      enqueued_at: "2026-05-17T02:00:00.000Z",
      status: "queued",
    });
    seedJob({
      enqueued_at: "2026-05-17T00:30:00.000Z",
      status: "researching", // queued でない
    });

    const claimed = await mockDeepResearchRepo.claimOldestQueued();
    expect(claimed?.id).toBe(older.id);
  });

  it("countInFlight: researching + structuring の合計を返す", async () => {
    seedJob({ status: "researching" });
    seedJob({ status: "researching" });
    seedJob({ status: "structuring" });
    seedJob({ status: "queued" });
    seedJob({ status: "done" });
    seedJob({ status: "failed" });

    const count = await mockDeepResearchRepo.countInFlight();
    expect(count).toBe(3);
  });

  it("countByUserSinceDay: 閾値以降の対象ユーザージョブのみ集計 (Task 6.1)", async () => {
    seedJob({
      user_id: USER_A,
      enqueued_at: "2026-05-17T10:00:00.000Z",
    });
    seedJob({
      user_id: USER_A,
      enqueued_at: "2026-05-17T15:00:00.000Z",
    });
    seedJob({
      user_id: USER_A,
      enqueued_at: "2026-05-16T20:00:00.000Z", // 閾値より前
    });
    seedJob({
      user_id: "00000000-0000-0000-0000-0000000000bb", // 別ユーザー
      enqueued_at: "2026-05-17T11:00:00.000Z",
    });

    const threshold = new Date("2026-05-17T00:00:00.000Z");
    const count = await mockDeepResearchRepo.countByUserSinceDay(
      USER_A,
      threshold,
    );
    expect(count).toBe(2);
  });

  it("countByMonth: yearMonthJST 接頭辞一致 (Task 6.1)", async () => {
    seedJob({ enqueued_at: "2026-05-17T10:00:00.000Z" });
    seedJob({ enqueued_at: "2026-05-31T23:00:00.000Z" });
    seedJob({ enqueued_at: "2026-04-30T15:00:00.000Z" });
    seedJob({ enqueued_at: "2026-06-01T00:00:00.000Z" });

    const may = await mockDeepResearchRepo.countByMonth("2026-05");
    const apr = await mockDeepResearchRepo.countByMonth("2026-04");
    expect(may).toBe(2);
    expect(apr).toBe(1);
  });

  it("findStuckJobs: research_started_at が閾値より古い in-flight のみ返す", async () => {
    const stuck = seedJob({
      status: "researching",
      research_started_at: "2026-05-16T00:00:00.000Z",
    });
    seedJob({
      status: "researching",
      research_started_at: "2026-05-17T05:00:00.000Z",
    });
    seedJob({
      status: "done",
      research_started_at: "2026-05-15T00:00:00.000Z", // 古いが状態が done
    });
    seedJob({
      store_id: STORE_2,
      status: "structuring",
      research_started_at: "2026-05-16T01:00:00.000Z",
    });

    const threshold = new Date("2026-05-17T00:00:00.000Z");
    const result = await mockDeepResearchRepo.findStuckJobs(threshold);
    const ids = result.map((j) => j.id).sort();
    expect(ids).toContain(stuck.id);
    expect(ids.length).toBe(2); // stuck + structuring の方
  });
});
