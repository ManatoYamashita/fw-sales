/**
 * DeepResearchRepository の Mock 実装 (deep-research-pipeline spec, Issue #43)
 *
 * `lib/mock/db.ts` の共有 `deepResearchJobs` / `deepResearchReports` Map を
 * 背後ストアとし、`USE_MOCK_DB=true` 時に `repos.deepResearch` 経由で参照される。
 *
 * 制約:
 * - `import "server-only"` を必ず付ける
 * - `claimOldestQueued` は擬似的にロックを表現する: Mock は単一プロセス・シリアル
 *   await の前提なので、`status === 'queued'` の最古を返した瞬間に呼出側が
 *   `updateJobStatus` で `researching` に遷移させることで「ロック相当」を実現
 * - id 形式は DB 実装と完全一致 (`generateId("job")` / `generateId("report")`)
 *
 * 関連: design.md §Components and Interfaces / deepResearchRepository,
 *       requirements.md §1.1, §1.2, §2.3, §5.5, §8.3
 */

import "server-only";

import type { DeepResearchRepository } from "@/lib/repositories/deep-research-repository";
import type {
  DeepResearchJob,
  DeepResearchJobErrorEntry,
  DeepResearchJobInsert,
  DeepResearchReport,
  DeepResearchReportInsert,
} from "@/types/deep-research";
import { isInFlightStatus, isPendingStatus } from "@/types/deep-research";
import { generateId } from "@/lib/utils/id";
import { mockDb } from "./db";

function nowIso(): string {
  return new Date().toISOString();
}

function compareEnqueuedAsc(
  a: DeepResearchJob,
  b: DeepResearchJob,
): number {
  return a.enqueued_at < b.enqueued_at ? -1 : 1;
}

export const mockDeepResearchRepo: DeepResearchRepository = {
  async findActiveByStore(storeId) {
    const all = [...mockDb.deepResearchJobs.values()]
      .filter((j) => j.store_id === storeId)
      .filter((j) => isPendingStatus(j.status))
      .sort(compareEnqueuedAsc);
    return all[0] ?? null;
  },

  async claimOldestQueued() {
    const queued = [...mockDb.deepResearchJobs.values()]
      .filter((j) => j.status === "queued")
      .sort(compareEnqueuedAsc);
    return queued[0] ?? null;
  },

  async findOldestResearching(limit) {
    const sliceLimit = Math.max(0, Math.min(limit, 100));
    return [...mockDb.deepResearchJobs.values()]
      .filter((j) => j.status === "researching")
      .sort(compareEnqueuedAsc)
      .slice(0, sliceLimit);
  },

  async countInFlight() {
    return [...mockDb.deepResearchJobs.values()].filter((j) =>
      isInFlightStatus(j.status),
    ).length;
  },

  async findStuckJobs(thresholdAt) {
    const cutoff = thresholdAt.toISOString();
    return [...mockDb.deepResearchJobs.values()].filter((j) => {
      if (!isInFlightStatus(j.status)) return false;
      const startedAt = j.research_started_at ?? j.enqueued_at;
      return startedAt < cutoff;
    });
  },

  async getById(jobId) {
    return mockDb.deepResearchJobs.get(jobId) ?? null;
  },

  async getReportByStore(storeId) {
    const reports = [...mockDb.deepResearchReports.values()]
      .filter((r) => r.store_id === storeId)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    return reports[0] ?? null;
  },

  async countByUserSinceDay(userId, sinceUTC) {
    const cutoff = sinceUTC.toISOString();
    return [...mockDb.deepResearchJobs.values()].filter(
      (j) => j.user_id === userId && j.enqueued_at >= cutoff,
    ).length;
  },

  async countByMonth(yearMonthJST) {
    // JST 月 → 当該月の UTC 範囲を求めるのは複雑なので、Mock では
    // enqueued_at の先頭 7 文字 ("YYYY-MM") との単純一致で代用する。
    // 厳密な JST 月境界は DB 実装側 (Drizzle + postgres `AT TIME ZONE`) で表現する。
    return [...mockDb.deepResearchJobs.values()].filter((j) =>
      j.enqueued_at.startsWith(yearMonthJST),
    ).length;
  },

  async insertJob(input: DeepResearchJobInsert) {
    const id = generateId("job");
    const now = nowIso();
    const job: DeepResearchJob = {
      id,
      store_id: input.store_id,
      user_id: input.user_id,
      status: "queued",
      deep_research_task_id: null,
      attempts: 0,
      error_log: null,
      enqueued_at: now,
      research_started_at: null,
      research_completed_at: null,
      completed_at: null,
    };
    mockDb.deepResearchJobs.set(id, job);
    return job;
  },

  async updateJobStatus(jobId, patch) {
    const current = mockDb.deepResearchJobs.get(jobId);
    if (!current) {
      throw new Error(`DeepResearchJob not found: ${jobId}`);
    }
    const next: DeepResearchJob = {
      ...current,
      status: patch.status,
      deep_research_task_id:
        patch.deep_research_task_id !== undefined
          ? patch.deep_research_task_id
          : current.deep_research_task_id,
      attempts:
        patch.attempts !== undefined ? patch.attempts : current.attempts,
      research_started_at:
        patch.research_started_at !== undefined
          ? patch.research_started_at
          : current.research_started_at,
      research_completed_at:
        patch.research_completed_at !== undefined
          ? patch.research_completed_at
          : current.research_completed_at,
      completed_at:
        patch.completed_at !== undefined
          ? patch.completed_at
          : current.completed_at,
    };
    mockDb.deepResearchJobs.set(jobId, next);
    return next;
  },

  async appendJobError(jobId, error: DeepResearchJobErrorEntry) {
    const current = mockDb.deepResearchJobs.get(jobId);
    if (!current) {
      throw new Error(`DeepResearchJob not found: ${jobId}`);
    }
    const next: DeepResearchJob = {
      ...current,
      error_log: [...(current.error_log ?? []), error],
    };
    mockDb.deepResearchJobs.set(jobId, next);
    return next;
  },

  async insertReport(input: DeepResearchReportInsert) {
    const id = generateId("report");
    const report: DeepResearchReport = {
      ...input,
      id,
      created_at: nowIso(),
    };
    mockDb.deepResearchReports.set(id, report);
    return report;
  },
};
