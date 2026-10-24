/**
 * HandoffRepository の Drizzle 実装。
 *
 * 役割:
 * - `lib/repositories/handoff-repository.ts` の `HandoffRepository` interface を Drizzle で 1:1 実装する
 * - `makeHandoffRepo(executor, tenantId)` で DB 接続とテナントを束縛し、
 *   トランザクション境界を呼び出し側 (Action 層) で制御できるようにする
 * - 未束縛の singleton は公開しない (#368)
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
import { and, eq, desc } from "drizzle-orm";
import { type DbClient, type Tx } from "./client";
import { deals, handoffs, stores } from "./schema";
import type { Handoff, HandoffInput, HandoffPatch } from "@/types/handoff";
import type { HandoffRepository } from "@/lib/repositories/handoff-repository";
import { generateId } from "@/lib/utils/id";
import { today } from "@/lib/utils/date";

/**
 * `HandoffRepository` を Drizzle で実装するファクトリ。
 *
 * - `executor` には `db` (singleton) または transaction `tx` を渡せる
 * - closure に executor と tenantId を保持する
 */
export function makeHandoffRepo(executor: DbClient | Tx, tenantId: string): HandoffRepository {
  const inTenant = eq(handoffs.tenant_id, tenantId);

  async function validateReferences(input: Pick<HandoffInput, "store_id" | "deal_id">): Promise<void> {
    const rows = await executor.select({ id: deals.id }).from(deals)
      .innerJoin(stores, and(eq(stores.id, deals.store_id), eq(stores.tenant_id, tenantId)))
      .where(and(eq(deals.tenant_id, tenantId), eq(deals.id, input.deal_id), eq(deals.store_id, input.store_id)))
      .limit(1);
    if (rows.length === 0) throw new Error("商談が見つかりません");
  }

  return {
    async list(storeId) {
      const rows = await executor.select().from(handoffs)
        .where(and(inTenant, storeId === undefined ? undefined : eq(handoffs.store_id, storeId)))
        .orderBy(desc(handoffs.created_at));
      return rows as Handoff[];
    },

    async get(id) {
      const rows = await executor
        .select()
        .from(handoffs)
        .where(and(inTenant, eq(handoffs.id, id)))
        .limit(1);
      return (rows[0] as Handoff | undefined) ?? null;
    },

    async getByDealId(dealId) {
      const rows = await executor
        .select()
        .from(handoffs)
        .where(and(inTenant, eq(handoffs.deal_id, dealId)))
        .limit(1);
      return (rows[0] as Handoff | undefined) ?? null;
    },

    async create(input: HandoffInput) {
      await validateReferences(input);
      const now = today();
      const row: Handoff = {
        ...input,
        id: generateId("hand"),
        created_at: now,
        updated_at: now,
      };
      await executor.insert(handoffs).values({ ...row, tenant_id: tenantId });
      return row;
    },

    async update(id, patch: HandoffPatch) {
      const current = await executor
        .select()
        .from(handoffs)
        .where(and(inTenant, eq(handoffs.id, id)))
        .limit(1);
      const head = current[0] as Handoff | undefined;
      if (!head) return null;
      if (patch.store_id !== undefined || patch.deal_id !== undefined) {
        await validateReferences({
          store_id: patch.store_id ?? head.store_id,
          deal_id: patch.deal_id ?? head.deal_id,
        });
      }
      const values = Object.fromEntries(Object.entries(patch).filter(([key, value]) =>
        value !== undefined && !["tenant_id", "id", "created_at"].includes(key),
      ));
      const rows = await executor.update(handoffs).set({ ...values, updated_at: today() })
        .where(and(inTenant, eq(handoffs.id, id))).returning();
      return (rows[0] as Handoff | undefined) ?? null;
    },

    async delete(id) {
      // postgres.js + drizzle の `delete().where(...)` は driver 依存で
      // 戻り値形状が `rowCount` を直接持たない場合があるため、
      // `RETURNING id` を使って削除行の存在を確実に判定する。
      const deleted = await executor
        .delete(handoffs)
        .where(and(inTenant, eq(handoffs.id, id)))
        .returning({ id: handoffs.id });
      return deleted.length > 0;
    },
  };
}
