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
import { eq, desc, and, or, ilike, inArray, gte, lte, sql, type SQL } from "drizzle-orm";
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
import type { PlacesBounds } from "@/lib/places/match-store";
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

/**
 * `StorePatch` を **指定された列だけを含む** UPDATE payload へ変換する
 * (feat/ai-research-quality-ux-hardening、最終レビュー指摘1)。
 *
 * ## なぜ全列 SET をやめるのか
 *
 * 旧 `update` は「現在行を SELECT → patch をマージ → `toDbRow(next)` で**全 Store 列**を
 * SET」という read-modify-write だった。この形は、行ロックを取らない writer が
 * 1つでも残っていると lost update を防げない:
 *
 *   1. 別 writer(例: `updateStorePatchAction`)が古い Store 行を読む
 *   2. review action が `basic_info` を更新して commit
 *   3. 別 writer が **古い basic_info を含む全列 SET** を行い、2 の更新を消す
 *
 * `getForUpdate` による行ロックは「ロックを取る writer 同士」しか直列化できない。
 * 書き込み範囲そのものを patch 列に絞れば、**無関係な列を触らない**ため
 * この経路が構造的に消える(異なる列への並行更新は衝突しなくなる)。
 *
 * ## 変換規則
 *
 * - `Store` のフィールド名は DB 列名と 1:1(`toDbRow` が単純 spread なのはそのため)。
 * - `undefined` は「変更しない」を意味し、payload から除外する。
 * - `null` は「NULL を書く」を意味し、**除外しない**(nullable 列のクリアが失われない)。
 * - `ai_analysis_result` のみ text 列へ JSON 文字列化する(`toDbRow` と同じ規則)。
 *   `null` はそのまま `null`。
 *
 * `toDbRow`(create 用・全列)の semantics は一切変更していない。
 */
function toDbPatch(patch: StorePatch): Partial<StoreInsertRow> {
  const row: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    // `undefined` = 未指定。`null` は有効な値なので除外しない。
    if (value === undefined) continue;
    row[key] =
      key === "ai_analysis_result" && value !== null ? JSON.stringify(value) : value;
  }
  return row as Partial<StoreInsertRow>;
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

    async getForUpdate(id) {
      // `SELECT ... FOR UPDATE`。トランザクション内でのみ意味を持つ
      // (interface 側 JSDoc 参照)。`research-run-repository.ts:getForUpdate` と同形。
      const rows = await executor
        .select()
        .from(stores)
        .where(eq(stores.id, id))
        .for("update")
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
      // patch で指定された列 + `updated_at` **のみ** を SET する(`toDbPatch` の JSDoc 参照)。
      // 事前 SELECT を廃し 1 文で完結させることで、read-modify-write 由来の
      // lost update が原理的に発生しなくなる。戻り値は `RETURNING` で
      // **実際に更新された行**から作るため、従来より正確になる
      // (`prompt-template-repository.ts:88-101` と同じ形)。
      const rows = await executor
        .update(stores)
        .set({ ...toDbPatch(patch), updated_at: today() })
        .where(eq(stores.id, id))
        .returning();
      const head = rows[0];
      return head ? fromDbRow(head) : null;
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
      // ON DELETE CASCADE (migration 0021 で再宣言 / #152) で連鎖削除される。
      // (0015 は水位線スキップで本番未適用のまま残った経緯があり、実効宣言は 0021。)
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
      // read-merge-write を 1 文脈で実行する(design.md §Persistence)。
      //
      // feat/ai-research-quality-ux-hardening(最終レビュー指摘1):
      // - 現在値の読み出しに **行ロック**(`SELECT ... FOR UPDATE`)を付ける。
      //   トランザクション内(`repos.transaction` 経由)で呼ばれた場合、
      //   他の `basic_info` writer と直列化される。
      // - 書き込みは **`basic_info` 列だけ**に絞る(旧実装は `toDbRow(next)` で全列 SET
      //   していたため、並行する `stage`/`memo` 更新等を巻き戻す余地があった)。
      const current = await executor
        .select()
        .from(stores)
        .where(eq(stores.id, id))
        .for("update")
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

      const rows = await executor
        .update(stores)
        .set({ basic_info: mergedBasicInfo, updated_at: today() })
        .where(eq(stores.id, id))
        .returning();
      const updatedRow = rows[0];
      // `RETURNING` が空になるのは、ロック取得後に別 tx が削除した場合のみ。
      if (!updatedRow) throw new Error(`Store not found: ${id}`);
      return fromDbRow(updatedRow);
    },

    async findAreaSearchCandidates({ googlePlaceIds, bounds }: {
      googlePlaceIds: string[];
      bounds?: PlacesBounds;
    }) {
      // No conditions at all — return early without touching the DB.
      if (googlePlaceIds.length === 0 && !bounds) return [];

      const conditions: SQL[] = [];

      if (googlePlaceIds.length > 0) {
        conditions.push(inArray(stores.google_place_id, googlePlaceIds));
      }

      if (bounds) {
        // All stores within the bbox are candidates, regardless of place ID.
        // This preserves name + proximity matching when Google changes a Place ID.
        // Stores with null lat/lng won't match gte/lte and are silently excluded
        // (correct: we can't do proximity matching without coordinates).
        const boundsCondition = and(
          gte(stores.lat, bounds.minLat),
          lte(stores.lat, bounds.maxLat),
          gte(stores.lng, bounds.minLng),
          lte(stores.lng, bounds.maxLng),
        );
        if (boundsCondition) conditions.push(boundsCondition);
      }

      const where = conditions.length === 1 ? conditions[0]! : or(...conditions)!;
      const rows = await executor
        .select()
        .from(stores)
        .where(where)
        .orderBy(desc(stores.created_at));
      return rows.map(fromDbRow);
    },
  };
}

/**
 * `db` singleton を束縛した既定 `StoreRepository` インスタンス。
 *
 * トランザクション内では呼び出し側で `makeStoreRepo(tx)` を都度生成して使用する。
 */
export const dbStoreRepo: StoreRepository = makeStoreRepo(db);
