/**
 * StoreRepository の Drizzle 実装。
 *
 * 役割:
 * - `lib/repositories/store-repository.ts` の `StoreRepository` interface を Drizzle で 1:1 実装する
 * - `makeStoreRepo(executor)` ファクトリで `DbClient` または `Tx` を受け取り、
 *   トランザクション境界を呼び出し側 (Action 層) で制御できるようにする
 * - 既定 export `dbStoreRepo` は `db` (singleton) を束縛したインスタンス
 *
 * 制約:
 * - `import "server-only"` を必ず付け、Client バンドルへの混入を防ぐ (Req 6.4)
 * - `StoreRepository` interface は無修正(Req 9.1)
 * - ID 形式は `<entity>_<id>` を維持 (Req 10.1)
 * - `created_at` / `updated_at` は `text` (`YYYY-MM-DD`) を維持 (Req 10.2)
 * - `StoreFilter.q` は `name` / `city` / `prefecture` / `address` / `genre` / `memo` の
 *   6 カラムに対する ILIKE 部分一致を OR 結合する。日本語文字列のため `lower()` は使わず、
 *   ILIKE のロケール依存挙動 (大文字小文字のみ無視) で十分とする (design.md Risks)
 *
 * 関連: design.md §「`lib/db/deal-repository.ts` / `lib/db/store-repository.ts`」,
 *       requirements.md §1.1, §1.4, §9.1, §10.1, §10.2
 */

import "server-only";
import { eq, desc, and, or, ilike, inArray, sql, type SQL } from "drizzle-orm";
import { db, type DbClient, type Tx } from "./client";
import { deals, handoffs, placeCandidates, research, stores } from "./schema";
import {
  OPERATOR_TYPES,
  type OperatorType,
  type Store,
  type StoreDeleteImpact,
  type StoreInput,
  type StorePatch,
  type StoreFilter,
} from "@/types/store";
import type { AiAnalysisResult } from "@/types/ai-analysis";
import type { BasicInfo, FillSource } from "@/types/basic-info";
import type { StoreRepository } from "@/lib/repositories/store-repository";
import { validateAiAnalysis } from "@/lib/ai/validate";
import { mergeBasicInfo as mergeBasicInfoPure } from "@/lib/domain/basic-info-merge";
import { generateId } from "@/lib/utils/id";
import { today } from "@/lib/utils/date";

/**
 * Drizzle schema から派生する DB row 型。`ai_analysis_result` は text 列のため
 * `string | null` であり、`Store.ai_analysis_result: AiAnalysisResult | null`
 * (オブジェクト形式) との間で双方向変換が必要(`toDbRow` / `fromDbRow`)。
 */
type StoreInsertRow = typeof stores.$inferInsert;
type StoreSelectRow = typeof stores.$inferSelect;

/**
 * `Store` (オブジェクト) を DB row (text 列の JSON 文字列) に変換する。
 * `data-actions.ts` / `scripts/seed.ts` でも `db.insert(stores).values(...)` の
 * 引数生成に再利用するため named export。
 *
 * @see fromDbRow - 逆変換
 */
export function toDbRow(store: Store): StoreInsertRow {
  return {
    ...store,
    ai_analysis_result:
      store.ai_analysis_result === null
        ? null
        : JSON.stringify(store.ai_analysis_result),
  };
}

function asOperatorType(raw: string): OperatorType {
  return (OPERATOR_TYPES as readonly string[]).includes(raw)
    ? (raw as OperatorType)
    : "未設定";
}

/**
 * 保存済 JSON 文字列を `AiAnalysisResult` に復元する。
 * 古いデータや破損データに対しては null にフェイルセーフし、UI を空状態にする。
 */
function parseStoredAiAnalysis(raw: string | null): AiAnalysisResult | null {
  if (raw === null || raw === "") return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    const result = validateAiAnalysis(parsed);
    return result.ok ? result.value : null;
  } catch {
    return null;
  }
}

/**
 * jsonb 列の `basic_info` を `BasicInfo` に復元する。
 *
 * drizzle が jsonb を自動 parse するため通常はオブジェクトが渡るが、本番 DB に
 * 破損データ(string / array / null)が混入した場合は空オブジェクトにフェイルセーフし
 * UI/マージ層が空状態として扱えるようにする。本格的な項目別キー検証は task 2.x
 * (`mergeBasicInfo` 周辺)に集約する。
 */
function parseStoredBasicInfo(raw: unknown): BasicInfo {
  if (raw === null || raw === undefined) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as BasicInfo;
}

/**
 * DB row を `Store` 型 (オブジェクト) に変換する。
 *
 * `priority` / `stage` / `channel` / `has_contact_form` は schema 上 text 列のため
 * `string` だが、Action 層で型ガード経由で投入する責務に従い、ここでは
 * `as Store` キャストで literal types を通す(既存パターン踏襲)。
 */
function fromDbRow(row: StoreSelectRow): Store {
  return {
    ...row,
    operator_type: asOperatorType(row.operator_type),
    ai_analysis_result: parseStoredAiAnalysis(row.ai_analysis_result),
    basic_info: parseStoredBasicInfo(row.basic_info),
  } as Store;
}

/**
 * `StoreFilter` から WHERE 条件 (`SQL`) を構築する。
 *
 * - `stage` / `priority` / `channel` は各々 `eq(...)` で比較し、未指定なら除外
 * - `q` は trim 後に空でない場合のみ、6 カラムへの `ILIKE` を `or(...)` で結合
 * - 全条件を `and(...)` で結合し、条件が無ければ `undefined` を返す
 *   (呼び出し側で `where` 句自体を省略するため)
 */
function buildFilterConditions(filter: StoreFilter): SQL | undefined {
  const conditions: SQL[] = [];

  if (filter.stage) conditions.push(eq(stores.stage, filter.stage));
  if (filter.channel) conditions.push(eq(stores.channel, filter.channel));
  // Phase 7 で user_id 参照に切替。filter.sales は profiles.id (uuid) を想定。
  if (filter.sales) conditions.push(eq(stores.assigned_sales_user_id, filter.sales));

  if (filter.q && filter.q.trim() !== "") {
    const like = `%${filter.q.trim()}%`;
    const qConditions = or(
      ilike(stores.name, like),
      ilike(stores.city, like),
      ilike(stores.prefecture, like),
      ilike(stores.address, like),
      ilike(stores.genre, like),
      ilike(stores.memo, like),
    );
    if (qConditions) conditions.push(qConditions);
  }

  if (conditions.length === 0) return undefined;
  return and(...conditions);
}

/**
 * `count(*)` の結果値を number へ正規化する (getDeleteImpact 用)。
 * `::int` キャストにより通常は number で返るが、driver 差異 (bigint / 文字列) にも
 * 防御的に対応し、解釈できない値は 0 に落とす。
 */
function toImpactCount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

/**
 * `StoreRepository` を Drizzle で実装するファクトリ。
 *
 * - `executor` には `db` (singleton) または transaction `tx` を渡せる
 * - 内部状態は持たず、closure には `executor` のみを保持する
 */
export function makeStoreRepo(executor: DbClient | Tx): StoreRepository {
  return {
    async list(filter = {}) {
      // ソート (created_at 降順) は常に適用し、フィルタ条件がある場合のみ
      // `where(...)` を追加する。条件が空なら全件取得となる
      const where = buildFilterConditions(filter);
      const query = executor
        .select()
        .from(stores)
        .orderBy(desc(stores.created_at));
      const rows = where ? await query.where(where) : await query;
      return rows.map(fromDbRow);
    },

    async get(id) {
      const rows = await executor
        .select()
        .from(stores)
        .where(eq(stores.id, id))
        .limit(1);
      const head = rows[0];
      return head ? fromDbRow(head) : null;
    },

    async create(input: StoreInput) {
      const now = today();
      const row: Store = {
        ...input,
        id: generateId("store"),
        created_at: now,
        updated_at: now,
      };
      await executor.insert(stores).values(toDbRow(row));
      return row;
    },

    async update(id, patch: StorePatch) {
      const current = await executor
        .select()
        .from(stores)
        .where(eq(stores.id, id))
        .limit(1);
      const headRow = current[0];
      if (!headRow) return null;
      const head = fromDbRow(headRow);
      const next: Store = {
        ...head,
        ...patch,
        updated_at: today(),
      };
      await executor.update(stores).set(toDbRow(next)).where(eq(stores.id, id));
      return next;
    },

    async delete(id) {
      // postgres.js + drizzle の `delete().where(...)` は driver 依存で
      // 戻り値形状が `rowCount` を直接持たない場合があるため、
      // `RETURNING id` を使って削除行の存在を確実に判定する
      const deleted = await executor
        .delete(stores)
        .where(eq(stores.id, id))
        .returning({ id: stores.id });
      return deleted.length > 0;
    },

    async bulkDelete(ids) {
      if (ids.length === 0) return 0;
      // 関連テーブル (deals / research / handoffs / handoffs.deal_id) は FK の
      // ON DELETE CASCADE (migration 0015) で連鎖削除される。
      // 単発 DML 文 `DELETE FROM stores WHERE id IN (...)` は PostgreSQL の
      // 暗黙 transaction で auto-commit され、CASCADE 連鎖含めて全件成功 OR
      // 全件 rollback の atomic 保証が標準で得られる。
      // PR #144 で導入した `executor.transaction(...)` wrap は Supabase Transaction
      // Pooler (pgbouncer transaction mode) と非互換で UNSAFE_TRANSACTION generic
      // エラーを誘発し UI が fallback 文言になる問題があったため撤回 (PR #144 / #N)。
      // statement_timeout の制御は別ルート (postgres-js の connection 設定 or
      // pgbouncer 設定 or chunk 分割) で別 PR で扱う。
      const deleted = await executor
        .delete(stores)
        .where(inArray(stores.id, ids))
        .returning({ id: stores.id });
      return deleted.length;
    },

    async getDeleteImpact(ids) {
      if (ids.length === 0) {
        return { deals: 0, research: 0, handoffs: 0, place_candidates: 0 };
      }
      // 単一 SELECT のスカラーサブクエリ ×4 で 1 往復・同一スナップショットの件数を得る
      // (design.md §StoreRepository.getDeleteImpact / Issue #152)。
      // - handoffs は store_id 基準で数える (deal_id 経由の間接連鎖は同一店舗前提の
      //   データモデルであり、二重計上を避ける)
      // - 存在しない ID は各 count が 0 になるだけでエラーにしない
      // - 読み取りのみ。delete / bulkDelete の単発 DML 構造 (原子性) には関与しない
      // - ID 群は `inArray` で合成する。`sql` テンプレートへ配列を直接埋め込むと
      //   スカラー展開されて `any(($1))` の不正 SQL になる (実 DB 検証で確認済み)
      const idArray = [...ids];
      const rows = await executor.execute(sql`
        select
          (select count(*)::int from ${deals} where ${inArray(deals.store_id, idArray)}) as deals,
          (select count(*)::int from ${research} where ${inArray(research.store_id, idArray)}) as research,
          (select count(*)::int from ${handoffs} where ${inArray(handoffs.store_id, idArray)}) as handoffs,
          (select count(*)::int from ${placeCandidates} where ${inArray(placeCandidates.matched_store_id, idArray)}) as place_candidates
      `);
      const row = (rows as Array<Record<string, unknown>>)[0];
      return {
        deals: toImpactCount(row?.deals),
        research: toImpactCount(row?.research),
        handoffs: toImpactCount(row?.handoffs),
        place_candidates: toImpactCount(row?.place_candidates),
      } satisfies StoreDeleteImpact;
    },

    async mergeBasicInfo(id, incoming, source: FillSource) {
      // 既存 `update` と同じ read-merge-write 原子性パターン:
      // 現在値 read → mergeBasicInfo 純関数で 1 ソース分のマージ → write を
      // 1 文脈で実行する(last-write-wins、design.md §Persistence)。
      const current = await executor
        .select()
        .from(stores)
        .where(eq(stores.id, id))
        .limit(1);
      const headRow = current[0];
      if (!headRow) {
        // design L298 の戻り型 `Promise<Store>` を尊重し throw。
        // 呼出側 (Action 層) で ActionResult.failure に変換する。
        throw new Error(`Store not found: ${id}`);
      }
      const head = fromDbRow(headRow);

      // `basic_info` 内の `updated_at` は ISO 8601 (design §Logical Data Model L338)。
      // 一方 `stores.updated_at` 列は既存規約で `YYYY-MM-DD` (text)。両者は別書式。
      const fieldNow = new Date().toISOString();
      const mergedBasicInfo = mergeBasicInfoPure(
        head.basic_info,
        incoming,
        source,
        fieldNow,
      );

      const next: Store = {
        ...head,
        basic_info: mergedBasicInfo,
        updated_at: today(),
      };
      await executor.update(stores).set(toDbRow(next)).where(eq(stores.id, id));
      return next;
    },
  };
}

/**
 * `db` singleton を束縛した既定 `StoreRepository` インスタンス。
 *
 * トランザクション内では呼び出し側で `makeStoreRepo(tx)` を都度生成して使用する。
 */
export const dbStoreRepo: StoreRepository = makeStoreRepo(db);
