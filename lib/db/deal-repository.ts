/**
 * DealRepository の Drizzle 実装。
 *
 * 役割:
 * - `lib/repositories/deal-repository.ts` の `DealRepository` interface を Drizzle で 1:1 実装する
 * - `makeDealRepo(executor)` ファクトリで `DbClient` または `Tx` を受け取り、
 *   トランザクション境界を呼び出し側 (Action 層) で制御できるようにする
 * - 既定 export `dbDealRepo` は `db` (singleton) を束縛したインスタンス
 *
 * 制約:
 * - `import "server-only"` を必ず付け、Client バンドルへの混入を防ぐ (Req 6.4)
 * - `DealRepository` interface は無修正(Req 9.1)
 * - ID 形式は `<entity>_<id>` を維持 (Req 10.1)
 * - `created_at` / `updated_at` は `text` (`YYYY-MM-DD`) を維持 (Req 10.2)
 * - nullable な `order_amount` は `null` を許容して往復させる
 *
 * 関連: design.md §「`lib/db/deal-repository.ts` / `lib/db/store-repository.ts`」,
 *       requirements.md §1.1, §1.4, §2.1〜2.5, §9.1, §10.1, §10.2
 */

import "server-only";
import { eq, desc } from "drizzle-orm";
import { db, type DbClient, type Tx } from "./client";
import { deals } from "./schema";
import type { Deal, DealInput, DealPatch } from "@/types/deal";
import type { DealRepository } from "@/lib/repositories/deal-repository";
import { generateId } from "@/lib/utils/id";
import { today } from "@/lib/utils/date";

/**
 * `DealRepository` を Drizzle で実装するファクトリ。
 *
 * - `executor` には `db` (singleton) または transaction `tx` を渡せる
 * - 内部状態は持たず、closure には `executor` のみを保持する
 */
export function makeDealRepo(executor: DbClient | Tx): DealRepository {
  return {
    async list(storeId) {
      // 共通のソート条件 (created_at 降順) を先に適用し、
      // storeId 指定時のみ where 句を追加する
      const rows = storeId
        ? await executor
            .select()
            .from(deals)
            .where(eq(deals.store_id, storeId))
            .orderBy(desc(deals.created_at))
        : await executor.select().from(deals).orderBy(desc(deals.created_at));
      return rows as Deal[];
    },

    async get(id) {
      const rows = await executor
        .select()
        .from(deals)
        .where(eq(deals.id, id))
        .limit(1);
      return (rows[0] as Deal | undefined) ?? null;
    },

    async create(input: DealInput) {
      const now = today();
      const row: Deal = {
        ...input,
        id: generateId("deal"),
        created_at: now,
        updated_at: now,
      };
      await executor.insert(deals).values(row);
      return row;
    },

    async update(id, patch: DealPatch) {
      const current = await executor
        .select()
        .from(deals)
        .where(eq(deals.id, id))
        .limit(1);
      const head = current[0] as Deal | undefined;
      if (!head) return null;
      const next: Deal = {
        ...head,
        ...patch,
        updated_at: today(),
      };
      await executor.update(deals).set(next).where(eq(deals.id, id));
      return next;
    },

    async delete(id) {
      // postgres.js + drizzle の `delete().where(...)` は driver 依存で
      // 戻り値形状が `rowCount` を直接持たない場合があるため、
      // `RETURNING id` を使って削除行の存在を確実に判定する
      const deleted = await executor
        .delete(deals)
        .where(eq(deals.id, id))
        .returning({ id: deals.id });
      return deleted.length > 0;
    },
  };
}

/**
 * `db` singleton を束縛した既定 `DealRepository` インスタンス。
 *
 * トランザクション内では呼び出し側で `makeDealRepo(tx)` を都度生成して使用する。
 */
export const dbDealRepo: DealRepository = makeDealRepo(db);
