/** 商談領域の全メソッドと主要集計を実 PostgreSQL の2テナントで検査する (#368 / #369)。 */
import { describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db, type Tx } from "@/lib/db/client";
import { makeDealRepo } from "@/lib/db/deal-repository";
import { makeHandoffRepo } from "@/lib/db/handoff-repository";
import { makeStoreRepo, toDbRow } from "@/lib/db/store-repository";
import { SEED_DEALS, SEED_HANDOFFS, SEED_STORES } from "@/lib/db/seed-data";
import { deals, handoffs, stores, tenants } from "@/lib/db/schema";
import type { DealRepository } from "@/lib/repositories/deal-repository";
import type { HandoffRepository } from "@/lib/repositories/handoff-repository";
import type { DealInput, DealPatch } from "@/types/deal";
import type { HandoffInput, HandoffPatch } from "@/types/handoff";
import { listDealsCached, getDealCached, listDealsByStoreCached } from "@/lib/queries/deals";
import { listHandoffsCached, getHandoffCached } from "@/lib/queries/handoffs";
import { getDashboardStats, getCacheableNavBadgeCounts } from "@/lib/queries/stats";
import { getKpiSnapshot } from "@/lib/queries/kpi";
import { getActionQueue } from "@/lib/queries/action-queue";
import { getPipelineColumns, getPipelineSummary } from "@/lib/queries/pipeline";

// キャッシュの実行環境だけを置き換え、クエリは同じ transaction の実 repository に接続する。
vi.mock("next/cache", () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));
let queryExecutor: Tx;
vi.mock("@/lib/repositories", () => ({ repos: {
  forTenant: (tenantId: string) => ({
    deal: makeDealRepo(queryExecutor, tenantId),
    handoff: makeHandoffRepo(queryExecutor, tenantId),
    store: makeStoreRepo(queryExecutor, tenantId),
  }),
} }));
// 非表示メニューを有効にしたときのバッジも検査する。
vi.mock("@/lib/domain/nav", () => ({ NAV_ITEMS: ["stores", "pipeline", "deals", "handoffs"].map((badgeKey) => ({ badgeKey })) }));

const A = "d3680000-0000-4000-8000-000000000001";
const B = "d3680000-0000-4000-8000-000000000002";
const USER_A = "d3680000-0000-4000-8000-00000000000a";
const USER_B = "d3680000-0000-4000-8000-00000000000b";
const SHARED_USER = "d3680000-0000-4000-8000-00000000000c";
const STORE_A = "commercial_store_a";
const STORE_B = "commercial_store_b";
const DEAL_A = "commercial_deal_a";
const DEAL_B = "commercial_deal_b";
const HANDOFF_A = "commercial_handoff_a";
const HANDOFF_B = "commercial_handoff_b";
const dealInput: DealInput = { ...SEED_DEALS[0]!, store_id: STORE_A, assigned_sales_user_id: null, status: "初回接触" };
const handoffInput: HandoffInput = { ...SEED_HANDOFFS[0]!, store_id: STORE_A, deal_id: DEAL_A, initial_fee: 100, monthly_fee: 10, status: "運用確認待ち" };

interface Fixture { tx: Tx; deal: DealRepository; handoff: HandoffRepository }
async function fixture(work: (fixture: Fixture) => Promise<void>): Promise<void> {
  const rollback = new Error("rollback commercial fixture");
  await expect(db.transaction(async (tx) => {
    queryExecutor = tx;
    await tx.insert(tenants).values([A, B].map((id, i) => ({ id, slug: `commercial-368-${i}`, name: id, created_at: "2026-10-24", updated_at: "2026-10-24" })));
    await tx.execute(sql`alter table deals alter column tenant_id drop default`);
    await tx.execute(sql`alter table handoffs alter column tenant_id drop default`);
    await tx.execute(sql`insert into auth.users (id, email, raw_user_meta_data) values
      (${USER_A}, 'commercial-a@example.test', '{}'), (${USER_B}, 'commercial-b@example.test', '{}'), (${SHARED_USER}, 'commercial-shared@example.test', '{}')`);
    await tx.execute(sql`insert into memberships (tenant_id, user_id, role, created_at, updated_at) values
      (${A}, ${USER_A}, 'member', '2026-10-24', '2026-10-24'), (${B}, ${USER_B}, 'member', '2026-10-24', '2026-10-24'),
      (${A}, ${SHARED_USER}, 'member', '2026-10-24', '2026-10-24'), (${B}, ${SHARED_USER}, 'member', '2026-10-24', '2026-10-24')`);
    for (const [tenantId, storeId, dealId, handoffId] of [[A, STORE_A, DEAL_A, HANDOFF_A], [B, STORE_B, DEAL_B, HANDOFF_B]] as const) {
      await tx.insert(stores).values({ ...toDbRow({ ...SEED_STORES[0]!, id: storeId, stage: "未調査" }), tenant_id: tenantId });
      await tx.insert(deals).values({ ...SEED_DEALS[0]!, ...dealInput, id: dealId, store_id: storeId, tenant_id: tenantId });
      await tx.insert(handoffs).values({ ...SEED_HANDOFFS[0]!, ...handoffInput, id: handoffId, store_id: storeId, deal_id: dealId, tenant_id: tenantId });
    }
    const foreignRows = async () => Promise.all([
      tx.select().from(stores).where(eq(stores.tenant_id, B)),
      tx.select().from(deals).where(eq(deals.tenant_id, B)),
      tx.select().from(handoffs).where(eq(handoffs.tenant_id, B)),
    ]);
    const before = await foreignRows();
    await work({ tx, deal: makeDealRepo(tx, A), handoff: makeHandoffRepo(tx, A) });
    expect(await foreignRows()).toEqual(before);
    throw rollback;
  })).rejects.toBe(rollback);
}

type IsolationCase = (fixture: Fixture) => Promise<void>;
const dealCases = {
  list: async ({ deal }) => {
    expect((await deal.list()).map((row) => row.id)).toEqual([DEAL_A]);
    expect((await deal.list(STORE_A)).map((row) => row.id)).toEqual([DEAL_A]);
    for (const id of [STORE_B, "missing", ""]) expect(await deal.list(id)).toEqual([]);
  },
  get: async ({ deal }) => {
    for (const id of [DEAL_B, "missing"]) expect(await deal.get(id)).toBeNull();
    expect(await deal.get(DEAL_A)).toMatchObject({ id: DEAL_A });
  },
  create: async ({ tx, deal }) => {
    const created = await deal.create({ ...dealInput, tenant_id: B } as DealInput);
    const [row] = await tx.select().from(deals).where(eq(deals.id, created.id));
    expect(row?.tenant_id).toBe(A);
  },
  update: async ({ tx, deal }) => {
    // 不正な参照先を渡しても、他社IDと不存在IDはどちらも未存在扱い。
    for (const id of [DEAL_B, "missing"]) expect(await deal.update(id, { store_id: STORE_B, assigned_sales_user_id: USER_B })).toBeNull();
    const [before] = await tx.select().from(deals).where(eq(deals.id, DEAL_A));
    expect(await deal.update(DEAL_A, { activity_memo: "更新", proposal: undefined, assigned_sales_user_id: null, tenant_id: B, id: "changed", created_at: "changed" } as DealPatch)).toMatchObject({ id: DEAL_A, activity_memo: "更新", proposal: before!.proposal, tenant_id: A, created_at: before!.created_at });
  },
  delete: async ({ deal, handoff }) => {
    for (const id of [DEAL_B, "missing"]) expect(await deal.delete(id)).toBe(false);
    expect(await deal.delete(DEAL_A)).toBe(true);
    expect(await handoff.get(HANDOFF_A)).toBeNull();
  },
} satisfies Record<keyof DealRepository, IsolationCase>;

const handoffCases = {
  list: async ({ handoff }) => {
    expect((await handoff.list()).map((row) => row.id)).toEqual([HANDOFF_A]);
    expect((await handoff.list(STORE_A)).map((row) => row.id)).toEqual([HANDOFF_A]);
    for (const id of [STORE_B, "missing", ""]) expect(await handoff.list(id)).toEqual([]);
  },
  get: async ({ handoff }) => {
    for (const id of [HANDOFF_B, "missing"]) expect(await handoff.get(id)).toBeNull();
    expect(await handoff.get(HANDOFF_A)).toMatchObject({ id: HANDOFF_A });
  },
  getByDealId: async ({ handoff }) => {
    for (const id of [DEAL_B, "missing"]) expect(await handoff.getByDealId(id)).toBeNull();
    expect(await handoff.getByDealId(DEAL_A)).toMatchObject({ id: HANDOFF_A });
  },
  create: async ({ tx, handoff }) => {
    const created = await handoff.create({ ...handoffInput, tenant_id: B } as HandoffInput);
    const [row] = await tx.select().from(handoffs).where(eq(handoffs.id, created.id));
    expect(row?.tenant_id).toBe(A);
  },
  update: async ({ tx, handoff }) => {
    for (const id of [HANDOFF_B, "missing"]) expect(await handoff.update(id, { store_id: STORE_B, deal_id: DEAL_B })).toBeNull();
    const [before] = await tx.select().from(handoffs).where(eq(handoffs.id, HANDOFF_A));
    expect(await handoff.update(HANDOFF_A, { caution: "更新", payment_confirmed: null, contract_services: undefined, tenant_id: B, id: "changed", created_at: "changed" } as HandoffPatch)).toMatchObject({ id: HANDOFF_A, caution: "更新", payment_confirmed: null, contract_services: before!.contract_services, tenant_id: A, created_at: before!.created_at });
  },
  delete: async ({ handoff }) => {
    for (const id of [HANDOFF_B, "missing"]) expect(await handoff.delete(id)).toBe(false);
    expect(await handoff.delete(HANDOFF_A)).toBe(true);
  },
} satisfies Record<keyof HandoffRepository, IsolationCase>;

describe("商談 repository 全メソッドのテナント分離", () => {
  it("対象表が空でなく、実メソッドをすべて含む", async () => {
    expect(Object.keys(dealCases).length).toBeGreaterThan(0);
    expect(Object.keys(handoffCases).length).toBeGreaterThan(0);
    await fixture(async ({ deal, handoff }) => {
      expect(Object.keys(dealCases).sort()).toEqual(Object.keys(deal).sort());
      expect(Object.keys(handoffCases).sort()).toEqual(Object.keys(handoff).sort());
    });
  });
  it.each(Object.entries(dealCases))("deal.%s", async (_, run) => fixture(run));
  it.each(Object.entries(handoffCases))("handoff.%s", async (_, run) => fixture(run));

  it("他社・不存在の店舗／担当者を拒否し、兼務ユーザーを受け入れる", async () => fixture(async ({ deal }) => {
    for (const id of [STORE_B, "missing"]) {
      await expect(deal.create({ ...dealInput, store_id: id })).rejects.toThrow("店舗が見つかりません");
      await expect(deal.update(DEAL_A, { store_id: id })).rejects.toThrow("店舗が見つかりません");
    }
    for (const id of [USER_B, "d3680000-0000-4000-8000-000000000099"]) {
      await expect(deal.create({ ...dealInput, assigned_sales_user_id: id })).rejects.toThrow("営業担当が見つかりません");
      await expect(deal.update(DEAL_A, { assigned_sales_user_id: id })).rejects.toThrow("営業担当が見つかりません");
    }
    for (const id of [USER_A, SHARED_USER]) {
      expect(await deal.create({ ...dealInput, assigned_sales_user_id: id })).toMatchObject({ assigned_sales_user_id: id });
      expect(await deal.update(DEAL_A, { assigned_sales_user_id: id })).toMatchObject({ assigned_sales_user_id: id });
    }
  }));

  it("引き継ぎ先の商談・店舗が同じテナントかつ同じ組み合わせであることを検証する", async () => fixture(async ({ tx, handoff }) => {
    for (const reference of [
      { store_id: STORE_B }, { deal_id: DEAL_B }, { store_id: STORE_B, deal_id: DEAL_B },
      { store_id: "missing" }, { deal_id: "missing" },
    ]) {
      await expect(handoff.create({ ...handoffInput, ...reference })).rejects.toThrow("商談が見つかりません");
      await expect(handoff.update(HANDOFF_A, reference)).rejects.toThrow("商談が見つかりません");
    }
    // 同じテナントでも、別の店舗に紐づく商談との取り違えを拒否する。
    await tx.insert(stores).values({ ...toDbRow({ ...SEED_STORES[0]!, id: "commercial_store_a2" }), tenant_id: A });
    await expect(handoff.create({ ...handoffInput, store_id: "commercial_store_a2" })).rejects.toThrow("商談が見つかりません");
    expect(await handoff.update(HANDOFF_A, { store_id: STORE_A, deal_id: DEAL_A })).not.toBeNull();
  }));

  it("主要な取得・集計に渡したテナントが適用され、同時に別テナントも取得できる", async () => fixture(async () => {
    for (const [tenantId, storeId, dealId, handoffId] of [[A, STORE_A, DEAL_A, HANDOFF_A], [B, STORE_B, DEAL_B, HANDOFF_B]] as const) {
      expect((await listDealsCached(tenantId)).map((row) => row.id)).toEqual([dealId]);
      expect(await getDealCached(tenantId, tenantId === A ? DEAL_B : DEAL_A)).toBeNull();
      expect((await listDealsByStoreCached(tenantId, storeId)).map((row) => row.id)).toEqual([dealId]);
      expect(await listDealsByStoreCached(tenantId, tenantId === A ? STORE_B : STORE_A)).toEqual([]);
      expect((await listHandoffsCached(tenantId)).map((row) => row.id)).toEqual([handoffId]);
      expect(await getHandoffCached(tenantId, tenantId === A ? HANDOFF_B : HANDOFF_A)).toBeNull();
      expect(await getDashboardStats(tenantId)).toMatchObject({ total: 1, totalRevenue: 100, monthlyRev: 0 });
      expect(await getKpiSnapshot(tenantId)).toMatchObject({ totalRevenue: 100, monthlyRecurring: 0, funnel: [expect.objectContaining({ count: 1 }), expect.anything(), expect.anything()] });
      const queue = await getActionQueue(tenantId);
      expect(queue.needsResearch.map((row) => row.id)).toEqual([storeId]);
      expect(queue.pendingHandoffs.map((row) => row.id)).toEqual([handoffId]);
      expect((await getPipelineColumns(tenantId)).flatMap((column) => column.stores.map((row) => row.id))).toEqual([storeId]);
      expect((await getPipelineSummary(tenantId)).reduce((sum, row) => sum + row.count, 0)).toBe(1);
      expect(await getCacheableNavBadgeCounts(tenantId)).toEqual({ stores: 1, pipeline: 1, deals: 1, handoffs: 1 });
    }
  }));
});
