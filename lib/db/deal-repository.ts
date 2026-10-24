/**
 * DealRepository の Drizzle 実装。
 *
 * 役割:
 * - `lib/repositories/deal-repository.ts` の `DealRepository` interface を Drizzle で 1:1 実装する
 * - `makeDealRepo(executor, tenantId)` で DB 接続とテナントを束縛し、
 *   トランザクション境界を呼び出し側 (Action 層) で制御できるようにする
 * - 未束縛の singleton は公開しない (#368)
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
import { and, eq, desc } from "drizzle-orm";
import { type DbClient, type Tx } from "./client";
import { deals, memberships, stores } from "./schema";
import type { Deal, DealInput, DealPatch } from "@/types/deal";
import type { DealRepository } from "@/lib/repositories/deal-repository";
import { generateId } from "@/lib/utils/id";
import { today } from "@/lib/utils/date";

/**
 * `DealRepository` を Drizzle で実装するファクトリ。
 *
 * - `executor` には `db` (singleton) または transaction `tx` を渡せる
 * - closure に executor と tenantId を保持する
 */
export function makeDealRepo(executor: DbClient | Tx, tenantId: string): DealRepository {
  const inTenant = eq(deals.tenant_id, tenantId);

  async function validateReferences(input: DealPatch): Promise<void> {
    if (input.store_id !== undefined) {
      const rows = await executor.select({ id: stores.id }).from(stores)
        .where(and(eq(stores.tenant_id, tenantId), eq(stores.id, input.store_id))).limit(1);
      if (rows.length === 0) throw new Error("店舗が見つかりません");
    }
    if (input.assigned_sales_user_id != null) {
      const rows = await executor.select({ id: memberships.user_id }).from(memberships)
        .where(and(eq(memberships.tenant_id, tenantId), eq(memberships.user_id, input.assigned_sales_user_id))).limit(1);
      if (rows.length === 0) throw new Error("営業担当が見つかりません");
    }
  }

  return {
    async list(storeId) {
      const rows = await executor.select().from(deals)
        .where(and(inTenant, storeId === undefined ? undefined : eq(deals.store_id, storeId)))
        .orderBy(desc(deals.created_at));
      return rows as Deal[];
    },

    async get(id) {
      const rows = await executor
        .select()
        .from(deals)
        .where(and(inTenant, eq(deals.id, id)))
        .limit(1);
      return (rows[0] as Deal | undefined) ?? null;
    },

    async create(input: DealInput) {
      await validateReferences(input);
      const now = today();
      const row: Deal = {
        ...input,
        id: generateId("deal"),
        created_at: now,
        updated_at: now,
      };
      await executor.insert(deals).values({ ...row, tenant_id: tenantId });
      return row;
    },

    async update(id, patch: DealPatch) {
      const current = await executor
        .select()
        .from(deals)
        .where(and(inTenant, eq(deals.id, id)))
        .limit(1);
      const head = current[0] as Deal | undefined;
      if (!head) return null;
      await validateReferences(patch);
      // 入力の追加プロパティで所属や識別子を書き換えず、指定列だけを更新する。
      const values = Object.fromEntries(Object.entries(patch).filter(([key, value]) =>
        value !== undefined && !["tenant_id", "id", "created_at"].includes(key),
      ));
      const rows = await executor.update(deals).set({ ...values, updated_at: today() })
        .where(and(inTenant, eq(deals.id, id))).returning();
      return (rows[0] as Deal | undefined) ?? null;
    },

    async delete(id) {
      // postgres.js + drizzle の `delete().where(...)` は driver 依存で
      // 戻り値形状が `rowCount` を直接持たない場合があるため、
      // `RETURNING id` を使って削除行の存在を確実に判定する
      const deleted = await executor
        .delete(deals)
        .where(and(inTenant, eq(deals.id, id)))
        .returning({ id: deals.id });
      return deleted.length > 0;
    },
  };
}
