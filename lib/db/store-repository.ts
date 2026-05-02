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
import { eq, desc, and, or, ilike, type SQL } from "drizzle-orm";
import { db, type DbClient, type Tx } from "./client";
import { stores } from "./schema";
import type { Store, StoreInput, StorePatch, StoreFilter } from "@/types/store";
import type { StoreRepository } from "@/lib/repositories/store-repository";
import { generateId } from "@/lib/utils/id";
import { today } from "@/lib/utils/date";

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
  if (filter.priority) conditions.push(eq(stores.priority, filter.priority));
  if (filter.channel) conditions.push(eq(stores.channel, filter.channel));

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
      return rows as Store[];
    },

    async get(id) {
      const rows = await executor
        .select()
        .from(stores)
        .where(eq(stores.id, id))
        .limit(1);
      return (rows[0] as Store | undefined) ?? null;
    },

    async create(input: StoreInput) {
      const now = today();
      const row: Store = {
        ...input,
        id: generateId("store"),
        created_at: now,
        updated_at: now,
      };
      await executor.insert(stores).values(row);
      return row;
    },

    async update(id, patch: StorePatch) {
      const current = await executor
        .select()
        .from(stores)
        .where(eq(stores.id, id))
        .limit(1);
      const head = current[0] as Store | undefined;
      if (!head) return null;
      const next: Store = {
        ...head,
        ...patch,
        updated_at: today(),
      };
      await executor.update(stores).set(next).where(eq(stores.id, id));
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
  };
}

/**
 * `db` singleton を束縛した既定 `StoreRepository` インスタンス。
 *
 * トランザクション内では呼び出し側で `makeStoreRepo(tx)` を都度生成して使用する。
 */
export const dbStoreRepo: StoreRepository = makeStoreRepo(db);
