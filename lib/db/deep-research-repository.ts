/**
 * DeepResearchRepository の Drizzle 実装 (deep-research-pipeline spec, Issue #43)
 *
 * `lib/repositories/deep-research-repository.ts` の interface を Drizzle で 1:1 実装。
 *
 * 制約:
 * - `import "server-only"` を必ず付ける
 * - `claimOldestQueued` は `SELECT ... FOR UPDATE SKIP LOCKED` を Drizzle `sql`
 *   template で組み立て、並走 cron tick の Stage 1 二重起動を防ぐ
 * - polling 系 (`findOldestResearching`) は冪等な API 呼出が前提のためロック不要
 * - id は `<entity>_<id>` 形式を継続: `job_<nanoid>` / `report_<nanoid>`
 * - 時刻列は `timestamptz`。アプリ層では ISO 8601 文字列で持ち回るため、
 *   `Date` → ISO 文字列の変換を `fromJobRow` / `fromReportRow` で行う
 *
 * 関連: design.md §Components and Interfaces / deepResearchRepository,
 *       requirements.md §1.1, §1.2, §2.3, §5.5, §8.3
 */

import "server-only";

import { and, asc, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";

import { db, type DbClient, type Tx } from "./client";
import { profiles, researchJobs, researchReports, stores } from "./schema";
import type { DeepResearchRepository } from "@/lib/repositories/deep-research-repository";
import type {
  DeepResearchJob,
  DeepResearchJobErrorEntry,
  DeepResearchJobInsert,
  DeepResearchJobStatusPatch,
  DeepResearchQueueRow,
  DeepResearchReport,
  DeepResearchReportCategories,
  DeepResearchReportInsert,
  HearingQuestion,
  JobStatus,
} from "@/types/deep-research";
import { isJobStatus } from "@/types/deep-research";
import { generateId } from "@/lib/utils/id";

type JobRow = typeof researchJobs.$inferSelect;
type ReportRow = typeof researchReports.$inferSelect;

const IN_FLIGHT_STATUSES: JobStatus[] = ["researching", "structuring"];
const PENDING_STATUSES: JobStatus[] = ["queued", "researching", "structuring"];

function toIsoString(d: Date | null): string | null {
  return d === null ? null : d.toISOString();
}

function asJobStatus(raw: string): JobStatus {
  if (isJobStatus(raw)) return raw;
  // 想定外の状態値は failed 扱いにフェイルセーフ (DB 直叩きで不正値が入った場合)
  return "failed";
}

/**
 * `listInFlight` / `listRecentDone` / `listRecentFailed` の SELECT で
 * 受け取る LEFT JOIN 結果を `DeepResearchQueueRow` に変換する。
 */
function fromQueueJoinRow(row: {
  job: JobRow;
  store_name: string | null;
  researcher_display_name: string | null;
}): DeepResearchQueueRow {
  return {
    job: fromJobRow(row.job),
    store_name: row.store_name,
    researcher_display_name: row.researcher_display_name,
  };
}

function fromJobRow(row: JobRow): DeepResearchJob {
  return {
    id: row.id,
    store_id: row.store_id,
    user_id: row.user_id,
    status: asJobStatus(row.status),
    deep_research_task_id: row.deep_research_task_id,
    attempts: row.attempts,
    error_log: (row.error_log as DeepResearchJobErrorEntry[] | null) ?? null,
    enqueued_at: row.enqueued_at.toISOString(),
    research_started_at: toIsoString(row.research_started_at),
    research_completed_at: toIsoString(row.research_completed_at),
    completed_at: toIsoString(row.completed_at),
  };
}

function fromReportRow(row: ReportRow): DeepResearchReport {
  return {
    id: row.id,
    job_id: row.job_id,
    store_id: row.store_id,
    category_1_basic: row.category_1_basic as DeepResearchReportCategories["category_1_basic"],
    category_2_owner: row.category_2_owner as DeepResearchReportCategories["category_2_owner"],
    category_3_menu: row.category_3_menu as DeepResearchReportCategories["category_3_menu"],
    category_4_customer: row.category_4_customer as DeepResearchReportCategories["category_4_customer"],
    category_5_marketing: row.category_5_marketing as DeepResearchReportCategories["category_5_marketing"],
    category_6_competitor: row.category_6_competitor as DeepResearchReportCategories["category_6_competitor"],
    category_7_owned_media: row.category_7_owned_media as DeepResearchReportCategories["category_7_owned_media"],
    category_8_other: row.category_8_other as DeepResearchReportCategories["category_8_other"],
    hearing_questions: row.hearing_questions as HearingQuestion[],
    full_markdown: row.full_markdown,
    all_source_urls: (row.all_source_urls as string[]) ?? [],
    total_cost_yen: row.total_cost_yen,
    total_duration_sec: row.total_duration_sec,
    created_at: row.created_at.toISOString(),
  };
}

export function makeDeepResearchRepo(
  executor: DbClient | Tx,
): DeepResearchRepository {
  return {
    async findActiveByStore(storeId) {
      const rows = await executor
        .select()
        .from(researchJobs)
        .where(
          and(
            eq(researchJobs.store_id, storeId),
            inArray(researchJobs.status, PENDING_STATUSES),
          ),
        )
        .orderBy(asc(researchJobs.enqueued_at))
        .limit(1);
      const row = rows[0];
      return row ? fromJobRow(row) : null;
    },

    async claimOldestQueued() {
      // FOR UPDATE SKIP LOCKED を使うため raw SQL を採用。
      // 取得した行は呼出側がそのトランザクション内で status を 'researching' へ
      // 更新することで「ロック相当」を実現する。
      const rows = await executor.execute(sql`
        SELECT * FROM "research_jobs"
        WHERE "status" = 'queued'
        ORDER BY "enqueued_at" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `);
      const first = (rows as unknown as JobRow[])[0];
      return first ? fromJobRow(first) : null;
    },

    async findOldestResearching(limit) {
      const safeLimit = Math.max(0, Math.min(limit, 100));
      if (safeLimit === 0) return [];
      const rows = await executor
        .select()
        .from(researchJobs)
        .where(eq(researchJobs.status, "researching"))
        .orderBy(asc(researchJobs.enqueued_at))
        .limit(safeLimit);
      return rows.map(fromJobRow);
    },

    async countInFlight() {
      const rows = await executor
        .select({ count: sql<number>`count(*)::int` })
        .from(researchJobs)
        .where(inArray(researchJobs.status, IN_FLIGHT_STATUSES));
      return rows[0]?.count ?? 0;
    },

    async listInFlight() {
      const rows = await executor
        .select({
          job: researchJobs,
          store_name: stores.name,
          researcher_display_name: profiles.display_name,
        })
        .from(researchJobs)
        .leftJoin(stores, eq(researchJobs.store_id, stores.id))
        .leftJoin(profiles, eq(researchJobs.user_id, profiles.id))
        .where(inArray(researchJobs.status, PENDING_STATUSES))
        .orderBy(asc(researchJobs.enqueued_at))
        .limit(200);
      return rows.map(fromQueueJoinRow);
    },

    async listRecentDone(limit) {
      const safeLimit = Math.max(1, Math.min(limit, 100));
      const rows = await executor
        .select({
          job: researchJobs,
          store_name: stores.name,
          researcher_display_name: profiles.display_name,
        })
        .from(researchJobs)
        .leftJoin(stores, eq(researchJobs.store_id, stores.id))
        .leftJoin(profiles, eq(researchJobs.user_id, profiles.id))
        .where(eq(researchJobs.status, "done"))
        .orderBy(desc(researchJobs.completed_at))
        .limit(safeLimit);
      return rows.map(fromQueueJoinRow);
    },

    async listRecentFailed(limit) {
      const safeLimit = Math.max(1, Math.min(limit, 100));
      const rows = await executor
        .select({
          job: researchJobs,
          store_name: stores.name,
          researcher_display_name: profiles.display_name,
        })
        .from(researchJobs)
        .leftJoin(stores, eq(researchJobs.store_id, stores.id))
        .leftJoin(profiles, eq(researchJobs.user_id, profiles.id))
        .where(eq(researchJobs.status, "failed"))
        .orderBy(desc(researchJobs.completed_at))
        .limit(safeLimit);
      return rows.map(fromQueueJoinRow);
    },

    async findStuckJobs(thresholdAt) {
      const rows = await executor
        .select()
        .from(researchJobs)
        .where(
          and(
            inArray(researchJobs.status, IN_FLIGHT_STATUSES),
            lt(researchJobs.research_started_at, thresholdAt),
          ),
        );
      return rows.map(fromJobRow);
    },

    async getById(jobId) {
      const rows = await executor
        .select()
        .from(researchJobs)
        .where(eq(researchJobs.id, jobId))
        .limit(1);
      const row = rows[0];
      return row ? fromJobRow(row) : null;
    },

    async getReportByStore(storeId) {
      const rows = await executor
        .select()
        .from(researchReports)
        .where(eq(researchReports.store_id, storeId))
        .orderBy(desc(researchReports.created_at))
        .limit(1);
      const row = rows[0];
      return row ? fromReportRow(row) : null;
    },

    async countByUserSinceDay(userId, sinceUTC) {
      const rows = await executor
        .select({ count: sql<number>`count(*)::int` })
        .from(researchJobs)
        .where(
          and(
            eq(researchJobs.user_id, userId),
            gte(researchJobs.enqueued_at, sinceUTC),
          ),
        );
      return rows[0]?.count ?? 0;
    },

    async countByMonth(yearMonthJST) {
      // yearMonthJST は "YYYY-MM" 形式の JST 月。JST 月境界を厳密に表現するため
      // AT TIME ZONE 'Asia/Tokyo' で受けてから比較する。
      const rows = await executor
        .select({ count: sql<number>`count(*)::int` })
        .from(researchJobs)
        .where(
          sql`to_char(${researchJobs.enqueued_at} AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM') = ${yearMonthJST}`,
        );
      return rows[0]?.count ?? 0;
    },

    async insertJob(input: DeepResearchJobInsert) {
      const id = generateId("job");
      const inserted = await executor
        .insert(researchJobs)
        .values({
          id,
          store_id: input.store_id,
          user_id: input.user_id,
        })
        .returning();
      const row = inserted[0];
      if (!row) {
        throw new Error("DeepResearchJob insert returned no row");
      }
      return fromJobRow(row);
    },

    async updateJobStatus(jobId, patch: DeepResearchJobStatusPatch) {
      const setClause: Partial<typeof researchJobs.$inferInsert> = {
        status: patch.status,
      };
      if (patch.deep_research_task_id !== undefined) {
        setClause.deep_research_task_id = patch.deep_research_task_id;
      }
      if (patch.attempts !== undefined) {
        setClause.attempts = patch.attempts;
      }
      if (patch.research_started_at !== undefined) {
        setClause.research_started_at =
          patch.research_started_at === null
            ? null
            : new Date(patch.research_started_at);
      }
      if (patch.research_completed_at !== undefined) {
        setClause.research_completed_at =
          patch.research_completed_at === null
            ? null
            : new Date(patch.research_completed_at);
      }
      if (patch.completed_at !== undefined) {
        setClause.completed_at =
          patch.completed_at === null ? null : new Date(patch.completed_at);
      }
      const updated = await executor
        .update(researchJobs)
        .set(setClause)
        .where(eq(researchJobs.id, jobId))
        .returning();
      const row = updated[0];
      if (!row) {
        throw new Error(`DeepResearchJob not found: ${jobId}`);
      }
      return fromJobRow(row);
    },

    async appendJobError(jobId, error: DeepResearchJobErrorEntry) {
      // jsonb 列に対する append は raw SQL で COALESCE + jsonb_build_array を使う
      const updated = await executor
        .update(researchJobs)
        .set({
          error_log: sql`COALESCE(${researchJobs.error_log}, '[]'::jsonb) || ${JSON.stringify([error])}::jsonb`,
        })
        .where(eq(researchJobs.id, jobId))
        .returning();
      const row = updated[0];
      if (!row) {
        throw new Error(`DeepResearchJob not found: ${jobId}`);
      }
      return fromJobRow(row);
    },

    async insertReport(input: DeepResearchReportInsert) {
      const id = generateId("report");
      const inserted = await executor
        .insert(researchReports)
        .values({
          id,
          job_id: input.job_id,
          store_id: input.store_id,
          category_1_basic: input.category_1_basic,
          category_2_owner: input.category_2_owner,
          category_3_menu: input.category_3_menu,
          category_4_customer: input.category_4_customer,
          category_5_marketing: input.category_5_marketing,
          category_6_competitor: input.category_6_competitor,
          category_7_owned_media: input.category_7_owned_media,
          category_8_other: input.category_8_other,
          hearing_questions: input.hearing_questions,
          full_markdown: input.full_markdown,
          all_source_urls: input.all_source_urls,
          total_cost_yen: input.total_cost_yen,
          total_duration_sec: input.total_duration_sec,
        })
        .returning();
      const row = inserted[0];
      if (!row) {
        throw new Error("DeepResearchReport insert returned no row");
      }
      return fromReportRow(row);
    },
  };
}

export const dbDeepResearchRepo: DeepResearchRepository =
  makeDeepResearchRepo(db);
