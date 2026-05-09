/**
 * HandoffRepository の Drizzle 実装。
 *
 * 役割:
 * - `lib/repositories/handoff-repository.ts` の `HandoffRepository` interface を Drizzle で 1:1 実装する
 * - `makeHandoffRepo(executor)` ファクトリで `DbClient` または `Tx` を受け取り、
 *   トランザクション境界を呼び出し側 (Action 層) で制御できるようにする
 * - 既定 export `dbHandoffRepo` は `db` (singleton) を束縛したインスタンス
 *
 * 制約:
 * - `import "server-only"` を必ず付け、Client バンドルへの混入を防ぐ (Req 9.4)
 * - `HandoffRepository` interface は無修正 (Req 9.5)
 * - ID 形式は `<entity>_<id>` (`hand_*`) を維持 (Req 10.1)
 * - `created_at` / `updated_at` は `text` (`YYYY-MM-DD`) を維持 (Req 10.2)
 * - `payment_confirmed` は `string | null` を Drizzle 側でそのまま往復させる (Req 10.3)
 *   - 空文字 `""` → `null` の自動変換は **行わず** Action 層 (`readString || null`) に委ねる
 *
 * 関連: design.md §「`lib/db/handoff-repository.ts` (新規)」,
 *       requirements.md §1.1, §1.4, §3.1〜3.7, §9.5, §10.1, §10.2, §10.3
 */

import "server-only";
import { eq, desc } from "drizzle-orm";
import { db, type DbClient, type Tx } from "./client";
import { handoffs } from "./schema";
import type { Handoff, HandoffInput, HandoffPatch } from "@/types/handoff";
import type { HandoffRepository } from "@/lib/repositories/handoff-repository";
import { generateId } from "@/lib/utils/id";
import { today } from "@/lib/utils/date";

/**
 * `HandoffRepository` を Drizzle で実装するファクトリ。
 *
 * - `executor` には `db` (singleton) または transaction `tx` を渡せる
 * - 内部状態は持たず、closure には `executor` のみを保持する
 */
export function makeHandoffRepo(executor: DbClient | Tx): HandoffRepository {
  return {
    async list(storeId) {
      // 共通のソート条件 (created_at 降順) を先に適用し、
      // storeId 指定時のみ where 句を追加する (mock 実装と同じセマンティクス)。
      const rows = storeId
        ? await executor
            .select()
            .from(handoffs)
            .where(eq(handoffs.store_id, storeId))
            .orderBy(desc(handoffs.created_at))
        : await executor
            .select()
            .from(handoffs)
            .orderBy(desc(handoffs.created_at));
      return rows as Handoff[];
    },

    async get(id) {
      const rows = await executor
        .select()
        .from(handoffs)
        .where(eq(handoffs.id, id))
        .limit(1);
      return (rows[0] as Handoff | undefined) ?? null;
    },

    async getByDealId(dealId) {
      const rows = await executor
        .select()
        .from(handoffs)
        .where(eq(handoffs.deal_id, dealId))
        .limit(1);
      return (rows[0] as Handoff | undefined) ?? null;
    },

    async create(input: HandoffInput) {
      const now = today();
      const row: Handoff = {
        ...input,
        id: generateId("hand"),
        created_at: now,
        updated_at: now,
      };
      await executor.insert(handoffs).values(row);
      return row;
    },

    async update(id, patch: HandoffPatch) {
      const current = await executor
        .select()
        .from(handoffs)
        .where(eq(handoffs.id, id))
        .limit(1);
      const head = current[0] as Handoff | undefined;
      if (!head) return null;
      const next: Handoff = {
        ...head,
        ...patch,
        updated_at: today(),
      };
      await executor.update(handoffs).set(next).where(eq(handoffs.id, id));
      return next;
    },

    async delete(id) {
      // postgres.js + drizzle の `delete().where(...)` は driver 依存で
      // 戻り値形状が `rowCount` を直接持たない場合があるため、
      // `RETURNING id` を使って削除行の存在を確実に判定する。
      const deleted = await executor
        .delete(handoffs)
        .where(eq(handoffs.id, id))
        .returning({ id: handoffs.id });
      return deleted.length > 0;
    },
  };
}

/**
 * `db` singleton を束縛した既定 `HandoffRepository` インスタンス。
 *
 * トランザクション内では呼び出し側で `makeHandoffRepo(tx)` を都度生成して使用する。
 */
export const dbHandoffRepo: HandoffRepository = makeHandoffRepo(db);
