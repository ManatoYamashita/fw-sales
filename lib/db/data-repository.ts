import "server-only";
import { and, eq, getTableColumns, ne, or, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { DbClient, Tx } from "./client";
import { stores, deals, handoffs, memberships, storeResearchRuns, placeCandidates } from "./schema";
import { toDbRow } from "./store-repository";
import { createTenantSeed } from "./tenant-seed";
import type { DataRepository } from "@/lib/repositories/data-repository";
import type { DbSnapshot } from "./snapshot";

/** JSONの余剰列は捨て、tenant_idは呼出側の束縛値だけから決める。 */
function rowFor<T extends PgTable>(table: T, input: object, tenantId: string): T["$inferInsert"] {
  const source = input as Record<string, unknown>;
  if (typeof source.id !== "string" || !source.id.trim()) throw new Error("IDが不正です");
  const row: Record<string, unknown> = { tenant_id: tenantId };
  for (const key of Object.keys(getTableColumns(table))) {
    if (key !== "tenant_id" && Object.hasOwn(source, key)) row[key] = source[key];
  }
  return row as T["$inferInsert"];
}

export function makeDataRepo(db: DbClient, tenantId: string): DataRepository {
  async function requireStore(tx: Tx, id: string) {
    const [store] = await tx.select({ id: stores.id }).from(stores)
      .where(and(eq(stores.tenant_id, tenantId), eq(stores.id, id))).limit(1).for("key share");
    if (!store) throw new Error("店舗が見つかりません");
  }
  async function requireMember(tx: Tx, id: string | null | undefined) {
    if (id == null) return;
    const [member] = await tx.select({ id: memberships.user_id }).from(memberships)
      .where(and(eq(memberships.tenant_id, tenantId), eq(memberships.user_id, id))).limit(1).for("key share");
    if (!member) throw new Error("担当者が見つかりません");
  }
  async function apply(tx: Tx, snapshot: Partial<DbSnapshot>) {
    // IDを維持する。他社とのPK衝突は更新0件として例外にし、先行する全変更も戻す。
    for (const store of snapshot.stores ?? []) {
      const row = rowFor(stores, toDbRow(store), tenantId);
      await requireMember(tx, row.assigned_planner_user_id);
      await requireMember(tx, row.assigned_sales_user_id);
      const written = await tx.insert(stores).values(row).onConflictDoUpdate({
        target: stores.id, set: row, setWhere: eq(stores.tenant_id, tenantId),
      }).returning({ id: stores.id });
      if (!written.length) throw new Error("インポートできませんでした");
    }
    for (const deal of snapshot.deals ?? []) {
      const row = rowFor(deals, deal, tenantId);
      await requireStore(tx, row.store_id);
      await requireMember(tx, row.assigned_sales_user_id);
      const written = await tx.insert(deals).values(row).onConflictDoUpdate({
        target: deals.id, set: row, setWhere: eq(deals.tenant_id, tenantId),
      }).returning({ id: deals.id });
      if (!written.length) throw new Error("インポートできませんでした");
    }
    for (const handoff of snapshot.handoffs ?? []) {
      const row = rowFor(handoffs, handoff, tenantId);
      await requireStore(tx, row.store_id);
      const [deal] = await tx.select({ storeId: deals.store_id }).from(deals)
        .where(and(eq(deals.tenant_id, tenantId), eq(deals.id, row.deal_id))).limit(1).for("key share");
      if (!deal || deal.storeId !== row.store_id) throw new Error("商談が見つかりません");
      const written = await tx.insert(handoffs).values(row).onConflictDoUpdate({
        target: handoffs.id, set: row, setWhere: eq(handoffs.tenant_id, tenantId),
      }).returning({ id: handoffs.id });
      if (!written.length) throw new Error("インポートできませんでした");
    }
  }
  async function clear(tx: Tx) {
    const ownStores = tx.select({ id: stores.id }).from(stores).where(eq(stores.tenant_id, tenantId));
    const ownDeals = tx.select({ id: deals.id }).from(deals).where(eq(deals.tenant_id, tenantId));
    // 複合FKを入れる#371までは古い他社参照も考慮する。親行をロックしてから、
    // CASCADE/SET NULLが他社へ波及する状態なら削除全体を拒否する。
    await tx.select({ id: stores.id }).from(stores).where(eq(stores.tenant_id, tenantId)).orderBy(stores.id).for("update");
    await tx.select({ id: deals.id }).from(deals).where(eq(deals.tenant_id, tenantId)).orderBy(deals.id).for("update");
    const foreignReferences = [
      tx.select({ id: deals.id }).from(deals).where(and(ne(deals.tenant_id, tenantId), sql`${deals.store_id} in (${ownStores})`)).limit(1),
      tx.select({ id: handoffs.id }).from(handoffs).where(and(ne(handoffs.tenant_id, tenantId), or(sql`${handoffs.store_id} in (${ownStores})`, sql`${handoffs.deal_id} in (${ownDeals})`))).limit(1),
      tx.select({ id: storeResearchRuns.id }).from(storeResearchRuns).where(and(ne(storeResearchRuns.tenant_id, tenantId), sql`${storeResearchRuns.store_id} in (${ownStores})`)).limit(1),
      tx.select({ id: placeCandidates.id }).from(placeCandidates).where(and(ne(placeCandidates.tenant_id, tenantId), sql`${placeCandidates.matched_store_id} in (${ownStores})`)).limit(1),
    ];
    for (const query of foreignReferences) if ((await query).length) throw new Error("関連データを確認してください");
    await tx.delete(handoffs).where(eq(handoffs.tenant_id, tenantId));
    await tx.delete(deals).where(eq(deals.tenant_id, tenantId));
    await tx.delete(stores).where(eq(stores.tenant_id, tenantId));
  }
  return {
    importSnapshot: (snapshot) => db.transaction((tx) => apply(tx, snapshot)),
    clear: () => db.transaction(clear),
    resetToSeed: () => db.transaction(async (tx) => { await clear(tx); await apply(tx, createTenantSeed(tenantId)); }),
  };
}
