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
 * `updateIfRunning` が SET 句へ載せてよい列の allowlist
 * (PR #180 final merge-blocker fix、F2)。
 *
 * `StoreResearchRunPatch` のキーと1:1で対応する。`satisfies` により、patch 型へ
 * フィールドが増えたのにここへ追加し忘れた場合は**型エラーにならず静かに無視される**
 * ことを避けたいが、逆方向(ここに存在しないキーを patch から拾う)は
 * 構造的に起こらないようにする。allowlist を経由することで、想定外のキーや
 * prototype 由来のプロパティが SET 句へ流れ込む余地を無くす。
 */
const PATCHABLE_COLUMNS = [
  "status",
  "stage",
  "result",
  "source_registry",
  "review_decisions",
  "review_completed_at",
  "token_usage",
  "warnings",
  "error_kind",
  "error_message",
  "finished_at",
] as const satisfies readonly (keyof StoreResearchRunPatch)[];

type StoreResearchRunUpdateSet = Partial<typeof storeResearchRuns.$inferInsert>;

/**
 * `StoreResearchRunPatch` を drizzle の SET 句へ変換する。
 *
 * - `undefined` のフィールドは**更新対象外**として SET 句に含めない
 * - `null` は「明示的に null へ更新する」意図として SET 句に含める
 */
function buildPatchSet(patch: StoreResearchRunPatch): StoreResearchRunUpdateSet {
  const set: StoreResearchRunUpdateSet = {};
  for (const column of PATCHABLE_COLUMNS) {
    const value = patch[column];
    if (value === undefined) continue;
    // allowlist 経由の代入のため、キーは必ず実在の列名に対応する。
    (set as Record<string, unknown>)[column] = value;
  }
  return set;
}

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

    /**
     * `status = 'running'` を条件に含む**単一の atomic UPDATE**で部分更新する
     * (PR #180 final merge-blocker fix、F2)。
     *
     * `update()` の `SELECT → JS マージ → 全列 SET` は意図的に使わない。
     * read と write の間に status が変わる TOCTOU が残るうえ、全列 SET は
     * patch に含まれない列まで巻き戻すため。ここでは patch に存在する列だけを
     * SET し、`RETURNING` で更新後の行をそのまま受け取る。
     *
     * 0行更新(run 不存在 / `status !== 'running'`)は `null` を返す。
     * 呼び出し側(Workflow)はこれを「この run はもう自分のものではない」と解釈する。
     */
    async updateIfRunning(id, patch: StoreResearchRunPatch) {
      const set = buildPatchSet(patch);
      // 更新対象が1つも無い patch で `.set({})` を発行しない(drizzle が例外を投げる)。
      if (Object.keys(set).length === 0) return null;

      const rows = await executor
        .update(storeResearchRuns)
        .set(set)
        .where(and(eq(storeResearchRuns.id, id), eq(storeResearchRuns.status, "running")))
        .returning();

      const row = rows[0];
      return row ? fromDbRow(row) : null;
    },
  };
}

export const dbResearchRunRepo: ResearchRunRepository = makeResearchRunRepo(db);
