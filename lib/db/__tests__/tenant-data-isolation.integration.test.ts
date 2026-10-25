/** データ移送の実DB検証。DMLはmockせず、各ケースをrollbackする (#370)。 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db, type DbClient, type Tx } from "@/lib/db/client";
import { makeDataRepo } from "@/lib/db/data-repository";
import { makeStoreRepo, toDbRow } from "@/lib/db/store-repository";
import { makeDealRepo } from "@/lib/db/deal-repository";
import { makeHandoffRepo } from "@/lib/db/handoff-repository";
import { stores, deals, handoffs, tenants, memberships, storeResearchRuns, placeCandidates } from "@/lib/db/schema";
import { SEED_STORES, SEED_DEALS, SEED_HANDOFFS } from "@/lib/db/seed-data";
import { createTenantSeed } from "@/lib/db/tenant-seed";
import type { DataRepository } from "@/lib/repositories/data-repository";
import type { DbSnapshot } from "@/lib/db/snapshot";

const A = "f3700000-0000-4000-8000-000000000001", B = "f3700000-0000-4000-8000-000000000002";
const UA = "f3700000-0000-4000-8000-00000000000a", UB = "f3700000-0000-4000-8000-00000000000b";
const SA = "data_store_a", SB = "data_store_b", DA = "data_deal_a", DB = "data_deal_b", HA = "data_handoff_a", HB = "data_handoff_b";
const ctx = vi.hoisted(() => ({ tx: null as unknown, signedIn: true, role: "admin", tag: vi.fn() }));
vi.mock("@/lib/tenant/context", () => ({ resolveTenantId: async () => "f3700000-0000-4000-8000-000000000002" }));
vi.mock("@/lib/supabase/server", () => ({ getCurrentProfile: async () => ctx.signedIn ? { id: "f3700000-0000-4000-8000-00000000000b", role: ctx.role, email: "data-b@example.test" } : null }));
vi.mock("next/cache", () => ({ revalidateTag: ctx.tag }));
vi.mock("@/lib/repositories", () => ({ repos: { forTenant: (id: string) => {
  expect(id).toBe(B);
  const tx = ctx.tx as Tx;
  return { data: makeDataRepo(transactional(tx), id), store: makeStoreRepo(tx, id), deal: makeDealRepo(tx, id), handoff: makeHandoffRepo(tx, id) };
} } }));
import { importJsonAction, clearAllAction, resetToSeedAction, getSnapshotForExportAction } from "@/lib/actions/data-actions";
import { GET } from "@/app/api/export/route";
function transactional(tx: Tx): DbClient { return { transaction: (work: (inner: Tx) => Promise<unknown>) => tx.transaction(work) } as unknown as DbClient; }
function store(id: string) { return { ...SEED_STORES[0]!, id }; }
function deal(id: string, storeId = SB) { return { ...SEED_DEALS[0]!, id, store_id: storeId }; }
function handoff(id: string, storeId = SB, dealId = DB) { return { ...SEED_HANDOFFS[0]!, id, store_id: storeId, deal_id: dealId }; }
async function snapshot(tx: Tx, tenantId: string) {
  return {
    stores: await tx.select().from(stores).where(eq(stores.tenant_id, tenantId)).orderBy(stores.id),
    deals: await tx.select().from(deals).where(eq(deals.tenant_id, tenantId)).orderBy(deals.id),
    handoffs: await tx.select().from(handoffs).where(eq(handoffs.tenant_id, tenantId)).orderBy(handoffs.id),
    runs: await tx.select().from(storeResearchRuns).where(eq(storeResearchRuns.tenant_id, tenantId)).orderBy(storeResearchRuns.id),
    candidates: await tx.select().from(placeCandidates).where(eq(placeCandidates.tenant_id, tenantId)).orderBy(placeCandidates.id),
  };
}
interface Fixture { tx: Tx; repo: DataRepository }
async function fixture(work: (f: Fixture) => Promise<void>, arrange?: (tx: Tx) => Promise<void>) {
  const rollback = new Error("rollback data fixture");
  await expect(db.transaction(async (tx) => {
    ctx.tx = tx;
    await tx.insert(tenants).values([A, B].map((id, i) => ({ id, slug: `data-370-${i}`, name: id, created_at: "2026-10-24", updated_at: "2026-10-24" })));
    await tx.execute(sql`insert into auth.users(id,email,raw_user_meta_data) values (${UA},'data-a@example.test','{}'),(${UB},'data-b@example.test','{}')`);
    await tx.insert(memberships).values([A, B].map((id, i) => ({ tenant_id: id, user_id: i ? UB : UA, role: "admin", created_at: "2026-10-24", updated_at: "2026-10-24" })));
    for (const [tenantId, s, d, h] of [[A, SA, DA, HA], [B, SB, DB, HB]] as const) {
      await tx.insert(stores).values({ ...toDbRow(store(s)), tenant_id: tenantId });
      await tx.insert(deals).values({ ...deal(d, s), tenant_id: tenantId });
      await tx.insert(handoffs).values({ ...handoff(h, s, d), tenant_id: tenantId });
      await tx.insert(storeResearchRuns).values({ id: `run_${s}`, tenant_id: tenantId, store_id: s, status: "succeeded", started_at: "2026-10-24T00:00:00Z", expires_at: "2026-10-25T00:00:00Z" });
      await tx.insert(placeCandidates).values({ id: `candidate_${s}`, tenant_id: tenantId, google_place_id: `place_${s}`, matched_store_id: s, first_seen_at: "2026-10-24", last_seen_at: "2026-10-24", created_at: "2026-10-24", updated_at: "2026-10-24" });
    }
    for (const table of ["stores", "deals", "handoffs"]) await tx.execute(sql.raw(`alter table ${table} alter column tenant_id drop default`));
    if (arrange) await arrange(tx);
    const before = await snapshot(tx, A);
    await work({ tx, repo: makeDataRepo(transactional(tx), B) });
    expect(await snapshot(tx, A)).toEqual(before);
    throw rollback;
  })).rejects.toBe(rollback);
}
function form(payload: unknown) { const fd = new FormData(); fd.set("file", new File([JSON.stringify(payload)], "snapshot.json")); return fd; }
beforeEach(() => { ctx.signedIn = true; ctx.role = "admin"; ctx.tag.mockClear(); vi.stubEnv("ALLOW_DATA_RESET", "1"); vi.stubEnv("VERCEL_ENV", "development"); });
afterEach(() => vi.unstubAllEnvs());
const cases = {
  importSnapshot: async ({ tx, repo }: Fixture) => {
    await repo.importSnapshot({ stores: [{ ...store(SB), memo: "own change", tenant_id: A } as ReturnType<typeof store>], deals: [{ ...deal(DB), tenant_id: A } as ReturnType<typeof deal>], handoffs: [{ ...handoff(HB), tenant_id: A } as ReturnType<typeof handoff>] });
    expect((await snapshot(tx, B)).stores).toEqual([expect.objectContaining({ id: SB, tenant_id: B, memo: "own change" })]);
  },
  clear: async ({ tx, repo }: Fixture) => {
    await repo.clear();
    const after = await snapshot(tx, B);
    expect(after).toMatchObject({ stores: [], deals: [], handoffs: [], runs: [], candidates: [expect.objectContaining({ matched_store_id: null })] });
  },
  resetToSeed: async ({ tx, repo }: Fixture) => {
    await repo.resetToSeed(); await repo.resetToSeed();
    const after = await snapshot(tx, B), seed = createTenantSeed(B);
    expect(after.stores.map(s => s.id).sort()).toEqual(seed.stores.map(s => s.id).sort());
    expect(after.deals.map(d => d.store_id)).toEqual(expect.arrayContaining(seed.deals.map(d => d.store_id)));
    expect(after.handoffs).toEqual([expect.objectContaining({ store_id: seed.handoffs[0]!.store_id, deal_id: seed.handoffs[0]!.deal_id })]);
    expect(after.stores.every(s => s.tenant_id === B)).toBe(true);
  },
} satisfies Record<keyof DataRepository, (f: Fixture) => Promise<void>>;

describe("所属を束縛した移送repository全メソッド", () => {
  it("対象表が空でなく実メソッドを全て含む", async () => fixture(async ({ repo }) => {
    expect(Object.keys(cases).length).toBeGreaterThan(0); expect(Object.keys(cases).sort()).toEqual(Object.keys(repo).sort());
  }));
  it.each(Object.entries(cases))("data.%s", async (_, run) => fixture(run));
  it.each([
    ["店舗", { stores: [store("new_before_conflict"), store(SA)] }],
    ["商談", { stores: [store("new_before_conflict")], deals: [deal(DA)] }],
    ["引き継ぎ", { stores: [store("new_before_conflict")], handoffs: [handoff(HA)] }],
    ["店舗参照", { stores: [store("new_before_conflict")], deals: [deal("new_deal", SA)] }],
    ["商談参照", { stores: [store("new_before_conflict")], handoffs: [handoff("new_handoff", SB, DA)] }],
    ["商談と店舗の不一致", { stores: [store("new_before_conflict")], handoffs: [handoff("new_handoff", "new_before_conflict", DB)] }],
    ["店舗の担当者", { stores: [{ ...store("new_before_conflict"), assigned_sales_user_id: UA }] }],
    ["商談の担当者", { stores: [store("new_before_conflict")], deals: [{ ...deal("new_deal"), assigned_sales_user_id: UA }] }],
  ] satisfies [string, Partial<DbSnapshot>][])("他社ID等の%sは先行した変更も全体rollback", async (_, data) => fixture(async ({ tx, repo }) => {
    const before = await snapshot(tx, B);
    await expect(repo.importSnapshot(data)).rejects.toThrow(); expect(await snapshot(tx, B)).toEqual(before);
  }));
  it("既存の自社行更新も後続衝突で取り消す", async () => fixture(async ({ tx, repo }) => {
    const before = await snapshot(tx, B);
    await expect(repo.importSnapshot({ stores: [{ ...store(SB), memo: "must rollback" }, store(SA)] })).rejects.toThrow();
    expect(await snapshot(tx, B)).toEqual(before);
  }));
  for (const method of ["clear", "resetToSeed"] as const) {
    it.each(["deal", "handoff", "run", "candidate"])(`${method}: 古い他社%s参照によるcascade/SET NULLも拒否`, async (kind) => fixture(async ({ repo }) => {
      await expect(repo[method]()).rejects.toThrow("関連データを確認してください");
    }, async tx => {
      // contract後も旧schemaでのアプリ保護を検証する。DDLはfixtureのrollbackで戻す。
      const legacy = {
        deal: ["deals", "deals_tenant_store_fk", "store_id", "stores", "cascade"],
        handoff: ["handoffs", "handoffs_tenant_deal_fk", "deal_id", "deals", "cascade"],
        run: ["store_research_runs", "store_research_runs_tenant_store_fk", "store_id", "stores", "cascade"],
        candidate: ["place_candidates", "place_candidates_tenant_store_fk", "matched_store_id", "stores", "set null"],
      }[kind as "deal" | "handoff" | "run" | "candidate"];
      const [table, constraint, column, parent, onDelete] = legacy;
      await tx.execute(sql.raw(`ALTER TABLE ${table} DROP CONSTRAINT ${constraint}`));
      await tx.execute(sql.raw(`ALTER TABLE ${table} ADD CONSTRAINT ${constraint} FOREIGN KEY (${column}) REFERENCES ${parent}(id) ON DELETE ${onDelete}`));
      if (kind === "deal") await tx.update(deals).set({ store_id: SB }).where(eq(deals.id, DA));
      if (kind === "handoff") await tx.update(handoffs).set({ deal_id: DB }).where(eq(handoffs.id, HA));
      if (kind === "run") await tx.update(storeResearchRuns).set({ store_id: SB }).where(eq(storeResearchRuns.id, `run_${SA}`));
      if (kind === "candidate") await tx.update(placeCandidates).set({ matched_store_id: SB }).where(eq(placeCandidates.id, `candidate_${SA}`));
    }));
  }
});
describe("Bの管理者から移送入口を実行する", () => {
  it("export route/actionはAを0件とし、3 entityのBだけを返す", async () => fixture(async () => {
    for (const data of [await (await GET()).json(), await getSnapshotForExportAction()]) {
      expect(data.stores.map((s: { id: string }) => s.id)).toEqual([SB]);
      expect(data.deals.map((d: { id: string }) => d.id)).toEqual([DB]);
      expect(data.handoffs.map((h: { id: string }) => h.id)).toEqual([HB]);
    }
  }));
  it("AのID入りJSONを拒否し、Bにも一部適用しない。タグを失効しない", async () => fixture(async ({ tx }) => {
    const before = await snapshot(tx, B);
    expect(await importJsonAction(null, form({ stores: [store("new_b"), store(SA)] }))).toMatchObject({ ok: false });
    expect(await snapshot(tx, B)).toEqual(before); expect(ctx.tag).not.toHaveBeenCalled();
  }));
  it.each([["全削除", clearAllAction], ["リセット", resetToSeedAction]] as const)("Bの%sはAを変更せず、Bのタグだけを失効する", async (_, action) => fixture(async () => {
    expect(await action()).toMatchObject({ ok: true }); expect(ctx.tag).toHaveBeenCalled();
    for (const [tag] of ctx.tag.mock.calls) expect(tag.startsWith(`tenant:${B}:`)).toBe(true);
  }));
  it("未所属・未ログインではexportの両入口とwriteを拒否する", async () => fixture(async () => {
    ctx.signedIn = false;
    expect((await GET()).status).toBe(401); await expect(getSnapshotForExportAction()).rejects.toThrow("ログイン");
    expect(await importJsonAction(null, form({ stores: [store("forbidden")] }))).toMatchObject({ ok: false });
    expect(ctx.tag).not.toHaveBeenCalled();
  }));
});
