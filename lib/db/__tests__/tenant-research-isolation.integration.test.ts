/** 調査repositoryの全メソッドを実DBの2テナントで検査する (#368 / #369)。 */
import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db, type Tx } from "@/lib/db/client";
import { makeResearchRunRepo } from "@/lib/db/research-run-repository";
import { toDbRow } from "@/lib/db/store-repository";
import { SEED_STORES } from "@/lib/db/seed-data";
import { stores, tenants, storeResearchRuns } from "@/lib/db/schema";
import type { ResearchRunRepository } from "@/lib/repositories/research-run-repository";
import type { StoreResearchRunPatch } from "@/types/research-run";

const A = "f3680000-0000-4000-8000-000000000001";
const B = "f3680000-0000-4000-8000-000000000002";
const UA = "f3680000-0000-4000-8000-00000000000a";
const UB = "f3680000-0000-4000-8000-00000000000b";
const SHARED = "f3680000-0000-4000-8000-00000000000c";
const SA = "research_store_a", SB = "research_store_b";
const RA = "research_running_a", RB = "research_running_b";
interface Fixture { tx: Tx; repo: ResearchRunRepository }
async function fixture(work: (f: Fixture) => Promise<void>): Promise<void> {
  const rollback = new Error("rollback research fixture");
  await expect(db.transaction(async (tx) => {
    await tx.insert(tenants).values([A, B].map((id, i) => ({ id, slug: `research-368-${i}`, name: id, created_at: "2026-10-24", updated_at: "2026-10-24" })));
    await tx.execute(sql`alter table store_research_runs alter column tenant_id drop default`);
    await tx.execute(sql`insert into auth.users(id,email,raw_user_meta_data) values (${UA},'research-a@example.test','{}'),(${UB},'research-b@example.test','{}'),(${SHARED},'research-shared@example.test','{}')`);
    await tx.execute(sql`insert into memberships(tenant_id,user_id,role,created_at,updated_at) values
      (${A},${UA},'member','2026-10-24','2026-10-24'),(${B},${UB},'member','2026-10-24','2026-10-24'),
      (${A},${SHARED},'member','2026-10-24','2026-10-24'),(${B},${SHARED},'member','2026-10-24','2026-10-24')`);
    for (const [tenantId, storeId, runId] of [[A, SA, RA], [B, SB, RB]] as const) {
      await tx.insert(stores).values({ ...toDbRow({ ...SEED_STORES[0]!, id: storeId }), tenant_id: tenantId });
      await tx.insert(storeResearchRuns).values([
        { id: runId, tenant_id: tenantId, store_id: storeId, status: "running", started_at: "2026-10-24T00:00:00Z", expires_at: "2026-10-25T00:00:00Z" },
        { id: `${runId}_success`, tenant_id: tenantId, store_id: storeId, status: "succeeded", started_at: "2026-10-23T00:00:00Z", expires_at: "2026-10-24T00:00:00Z" },
        { id: `${runId}_reviewed`, tenant_id: tenantId, store_id: storeId, status: "succeeded", review_completed_at: "2026-10-22T01:00:00Z", started_at: "2026-10-22T00:00:00Z", expires_at: "2026-10-23T00:00:00Z" },
      ]);
    }
    const before = await tx.select().from(storeResearchRuns).where(eq(storeResearchRuns.tenant_id, B));
    await work({ tx, repo: makeResearchRunRepo(tx, A) });
    expect(await tx.select().from(storeResearchRuns).where(eq(storeResearchRuns.tenant_id, B))).toEqual(before);
    throw rollback;
  })).rejects.toBe(rollback);
}
type IsolationCase = (f: Fixture) => Promise<void>;
const cases = {
  create: async ({ tx, repo }) => {
    // 別のA店舗に作り、既存running行との部分一意制約の衝突を避ける。
    await tx.insert(stores).values({ ...toDbRow({ ...SEED_STORES[0]!, id: `${SA}_new` }), tenant_id: A });
    const created = await repo.create({ store_id: `${SA}_new`, requested_by_user_id: SHARED });
    const [row] = await tx.select().from(storeResearchRuns).where(eq(storeResearchRuns.id, created.id));
    expect(row).toMatchObject({ tenant_id: A, requested_by_user_id: SHARED });
  },
  get: async ({ repo }) => {
    for (const id of [RB, "missing"]) expect(await repo.get(id)).toBeNull();
    expect(await repo.get(RA)).toMatchObject({ id: RA });
  },
  getForUpdate: async ({ repo }) => {
    for (const id of [RB, "missing"]) expect(await repo.getForUpdate(id)).toBeNull();
    expect(await repo.getForUpdate(RA)).toMatchObject({ id: RA });
  },
  getLatestForStore: async ({ repo }) => {
    for (const id of [SB, "missing"]) expect(await repo.getLatestForStore(id)).toBeNull();
    expect(await repo.getLatestForStore(SA)).toMatchObject({ id: RA });
  },
  listForStore: async ({ repo }) => {
    for (const id of [SB, "missing"]) expect(await repo.listForStore(id)).toEqual([]);
    expect((await repo.listForStore(SA)).map((row) => row.id)).toEqual([RA, `${RA}_success`, `${RA}_reviewed`]);
    expect((await repo.listForStore(SA, 1)).map((row) => row.id)).toEqual([RA]);
  },
  listStoreIdsNeedingReview: async ({ repo }) => {
    expect(await repo.listStoreIdsNeedingReview()).toEqual([SA]);
    await repo.update(`${RA}_success`, { review_completed_at: "2026-10-24T01:00:00Z" });
    expect(await repo.listStoreIdsNeedingReview()).toEqual([]);
  },
  count: async ({ repo }) => { expect(await repo.count()).toBe(3); },
  update: async ({ repo }) => {
    for (const id of [RB, "missing"]) expect(await repo.update(id, { status: "failed" })).toBeNull();
    expect(await repo.update(RA, { warnings: ["own"], stage: undefined, store_id: SB, requested_by_user_id: UB, tenant_id: B, id: RB } as StoreResearchRunPatch))
      .toMatchObject({ id: RA, store_id: SA, requested_by_user_id: null, warnings: ["own"], stage: null });
  },
  updateIfRunning: async ({ repo }) => {
    for (const id of [RB, "missing", `${RA}_success`]) expect(await repo.updateIfRunning(id, { status: "failed" })).toBeNull();
    expect(await repo.updateIfRunning(RA, {})).toBeNull();
    expect(await repo.updateIfRunning(RA, { stage: "researching" })).toMatchObject({ id: RA, stage: "researching" });
    expect(await repo.updateIfRunning(RA, { status: "failed", error_kind: "stuck_run_timeout" })).toMatchObject({ status: "failed" });
    expect(await repo.updateIfRunning(RA, { status: "succeeded" })).toBeNull();
    expect(await repo.get(RA)).toMatchObject({ status: "failed", error_kind: "stuck_run_timeout" });
  },
} satisfies Record<keyof ResearchRunRepository, IsolationCase>;

describe("調査repository全メソッドのテナント分離", () => {
  it("対象表が空でなく、実メソッドをすべて含む", async () => {
    expect(Object.keys(cases).length).toBeGreaterThan(0);
    await fixture(async ({ repo }) => { expect(Object.keys(cases).sort()).toEqual(Object.keys(repo).sort()); });
  });
  it.each(Object.entries(cases))("researchRun.%s", async (_, run) => fixture(run));
  it("他社／不存在の店舗と依頼者を拒否し、同じ所属と兼務者を受け入れる", async () => fixture(async ({ tx, repo }) => {
    for (const storeId of [SB, "missing"]) await expect(repo.create({ store_id: storeId, requested_by_user_id: UA })).rejects.toThrow("店舗が見つかりません");
    for (const userId of [UB, "f3680000-0000-4000-8000-000000000099"]) await expect(repo.create({ store_id: SA, requested_by_user_id: userId })).rejects.toThrow("依頼者が見つかりません");
    for (const [index, userId] of [UA, SHARED, null].entries()) {
      const storeId = `${SA}_requester_${index}`;
      await tx.insert(stores).values({ ...toDbRow({ ...SEED_STORES[0]!, id: storeId }), tenant_id: A });
      expect(await repo.create({ store_id: storeId, requested_by_user_id: userId })).toMatchObject({ requested_by_user_id: userId });
    }
  }));
});
