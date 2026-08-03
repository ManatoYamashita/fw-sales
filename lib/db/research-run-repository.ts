/**
 * ResearchRunRepository の Drizzle 実装 (AI 店舗調査再設計 Plan v3.2, PR1: データモデル基盤)
 *
 * `lib/repositories/research-run-repository.ts` の interface を Drizzle で 1:1 実装。
 *
 * 制約:
 * - `import "server-only"` を必ず付け、Client バンドルへの混入を防ぐ
 * - ID 形式は `<entity>_<id>` を維持 (既存規約)
 * - `started_at` / `expires_at` / `finished_at` / `review_completed_at` は
 *   ISO 8601 文字列 (timestamptz 列、mode: "string")
 *
 * 関連: lib/repositories/research-run-repository.ts, types/research-run.ts
 */

import "server-only";

import { and, desc, eq, isNull } from "drizzle-orm";
import { db, type DbClient, type Tx } from "./client";
import { storeResearchRuns } from "./schema";
import type {
  ResearchRunRepository,
} from "@/lib/repositories/research-run-repository";
import type {
  ReviewDecisions,
  SourceRegistryEntry,
  StoreResearchRun,
  StoreResearchRunPatch,
  StoreResearchRunStage,
  StoreResearchRunStatus,
} from "@/types/research-run";
import { generateId } from "@/lib/utils/id";
import { nowIso } from "@/lib/utils/date";
import { getResearchRunExpiresMarginMinutes } from "@/lib/env";

type StoreResearchRunSelectRow = typeof storeResearchRuns.$inferSelect;

/**
 * jsonb 列の防御的パース。drizzle が jsonb を自動 parse するため通常は
 * オブジェクト/配列が渡るが、破損データ混入時は安全な既定値にフェイルセーフする
 * (`parseStoredBasicInfo` と同じ方針、`lib/db/store-repository.ts` 参照)。
 */
function parseSourceRegistry(raw: unknown): SourceRegistryEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw as SourceRegistryEntry[];
}

function parseReviewDecisions(raw: unknown): ReviewDecisions {
  if (raw === null || raw === undefined) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as ReviewDecisions;
}

function parseWarnings(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw as string[];
}

function parseStatus(raw: string): StoreResearchRunStatus {
  return raw === "succeeded" || raw === "failed" ? raw : "running";
}

function parseStage(raw: string | null): StoreResearchRunStage | null {
  if (raw === "discovering" || raw === "researching" || raw === "done") {
    return raw;
  }
  return null;
}

function fromDbRow(row: StoreResearchRunSelectRow): StoreResearchRun {
  return {
    id: row.id,
    store_id: row.store_id,
    requested_by_user_id: row.requested_by_user_id,
    status: parseStatus(row.status),
    stage: parseStage(row.stage),
    result: row.result ?? null,
    source_registry: parseSourceRegistry(row.source_registry),
    review_decisions: parseReviewDecisions(row.review_decisions),
    review_completed_at: row.review_completed_at,
    token_usage: row.token_usage ?? null,
    warnings: parseWarnings(row.warnings),
    error_kind: row.error_kind,
    error_message: row.error_message,
    started_at: row.started_at,
    expires_at: row.expires_at,
    finished_at: row.finished_at,
  };
}

export function makeResearchRunRepo(
  executor: DbClient | Tx,
): ResearchRunRepository {
  return {
    async create({ store_id, requested_by_user_id }) {
      const startedAt = nowIso();
      const marginMinutes = getResearchRunExpiresMarginMinutes();
      const expiresAt = new Date(
        Date.parse(startedAt) + marginMinutes * 60_000,
      ).toISOString();

      const row = {
        id: generateId("research_run"),
        store_id,
        requested_by_user_id,
        status: "running" as const,
        stage: null,
        result: null,
        source_registry: [],
        review_decisions: {},
        review_completed_at: null,
        token_usage: null,
        warnings: [],
        error_kind: null,
        error_message: null,
        started_at: startedAt,
        expires_at: expiresAt,
        finished_at: null,
      };

      await executor.insert(storeResearchRuns).values(row);
      return fromDbRow(row as StoreResearchRunSelectRow);
    },

    async get(id) {
      const rows = await executor
        .select()
        .from(storeResearchRuns)
        .where(eq(storeResearchRuns.id, id))
        .limit(1);
      const row = rows[0];
      return row ? fromDbRow(row) : null;
    },

    async getLatestForStore(storeId) {
      const rows = await executor
        .select()
        .from(storeResearchRuns)
        .where(eq(storeResearchRuns.store_id, storeId))
        .orderBy(desc(storeResearchRuns.started_at))
        .limit(1);
      const row = rows[0];
      return row ? fromDbRow(row) : null;
    },

    async listForStore(storeId, limit = 10) {
      const rows = await executor
        .select()
        .from(storeResearchRuns)
        .where(eq(storeResearchRuns.store_id, storeId))
        .orderBy(desc(storeResearchRuns.started_at))
        .limit(limit);
      return rows.map(fromDbRow);
    },

    async listStoreIdsNeedingReview() {
      const rows = await executor
        .selectDistinct({ store_id: storeResearchRuns.store_id })
        .from(storeResearchRuns)
        .where(
          and(
            eq(storeResearchRuns.status, "succeeded"),
            isNull(storeResearchRuns.review_completed_at),
          ),
        );
      return rows.map((row) => row.store_id);
    },

    async getForUpdate(id) {
      const rows = await executor
        .select()
        .from(storeResearchRuns)
        .where(eq(storeResearchRuns.id, id))
        .for("update")
        .limit(1);
      const row = rows[0];
      return row ? fromDbRow(row) : null;
    },

    async update(id, patch: StoreResearchRunPatch) {
      const current = await executor
        .select()
        .from(storeResearchRuns)
        .where(eq(storeResearchRuns.id, id))
        .limit(1);
      const headRow = current[0];
      if (!headRow) return null;

      const head = fromDbRow(headRow);
      const next: StoreResearchRun = { ...head, ...patch };

      await executor
        .update(storeResearchRuns)
        .set({
          status: next.status,
          stage: next.stage,
          result: next.result,
          source_registry: next.source_registry,
          review_decisions: next.review_decisions,
          review_completed_at: next.review_completed_at,
          token_usage: next.token_usage,
          warnings: next.warnings,
          error_kind: next.error_kind,
          error_message: next.error_message,
          finished_at: next.finished_at,
        })
        .where(eq(storeResearchRuns.id, id));

      return next;
    },
  };
}

export const dbResearchRunRepo: ResearchRunRepository = makeResearchRunRepo(db);
