/** 店舗領域の全メソッドを実 PostgreSQL の 2 テナントで検査する (#368 / #369)。 */
import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db, type Tx } from "@/lib/db/client";
import { makeStoreRepo, toDbRow } from "@/lib/db/store-repository";
import { makePlaceCandidateRepo } from "@/lib/db/place-candidate-repository";
import { SEED_STORES, SEED_DEALS, SEED_HANDOFFS } from "@/lib/db/seed-data";
import { stores, tenants, deals, handoffs, storeResearchRuns } from "@/lib/db/schema";
import type { StoreRepository } from "@/lib/repositories/store-repository";
import type { PlaceCandidateRepository, UpsertPlaceCandidatesFromAreaSearchParams } from "@/lib/repositories/place-candidate-repository";
import type { StoreInput } from "@/types/store";

const A = "a3680000-0000-4000-8000-000000000001";
const B = "a3680000-0000-4000-8000-000000000002";
const USER_A = "a3680000-0000-4000-8000-00000000000a";
const USER_B = "a3680000-0000-4000-8000-00000000000b";
const ZERO_IMPACT = { deals: 0, handoffs: 0, store_research_runs: 0, place_candidates: 0 };
const input: StoreInput = { ...SEED_STORES[0]!, name: "共通の検索語", google_place_id: "shared-place", lat: 35.5, lng: 139.5 };

interface Fixture {
  tx: Tx;
  repo: StoreRepository;
  candidates: PlaceCandidateRepository;
}
async function fixture(work: (fixture: Fixture) => Promise<void>): Promise<void> {
  const rollback = new Error("rollback tenant fixture");
  await expect(db.transaction(async (tx) => {
    await tx.insert(tenants).values([A, B].map((id, i) => ({ id, slug: `test-368-${i}`, name: id, created_at: "2026-10-19", updated_at: "2026-10-19" })));
    // DEFAULT を外しても移行済み repository の INSERT が成功することを毎回検証する。
    await tx.execute(sql`alter table stores alter column tenant_id drop default`);
    await tx.execute(sql`alter table place_candidates alter column tenant_id drop default`);
    for (const [tenantId, suffix] of [[A, "a"], [B, "b"]] as const) {
      await tx.insert(stores).values({ ...toDbRow({ ...SEED_STORES[0]!, ...input, id: `store_368_${suffix}` }), tenant_id: tenantId });
      await tx.insert(deals).values({ ...SEED_DEALS[0]!, id: `deal_368_${suffix}`, store_id: `store_368_${suffix}`, tenant_id: tenantId });
      await tx.insert(handoffs).values({ ...SEED_HANDOFFS[0]!, id: `handoff_368_${suffix}`, deal_id: `deal_368_${suffix}`, store_id: `store_368_${suffix}`, tenant_id: tenantId });
      await tx.insert(storeResearchRuns).values({ id: `run_368_${suffix}`, store_id: `store_368_${suffix}`, tenant_id: tenantId, started_at: "2026-10-19T00:00:00Z", expires_at: "2026-10-20T00:00:00Z" });
      await makePlaceCandidateRepo(tx, tenantId).upsertFromAreaSearch(candidateInput(`place_${suffix}`, `store_368_${suffix}`));
    }
    await work({ tx, repo: makeStoreRepo(tx, A), candidates: makePlaceCandidateRepo(tx, A) });
    // すべての操作後に B の店舗と関連行が変わっていないことを確かめる。
    const foreign = await makeStoreRepo(tx, B).get("store_368_b");
    expect(foreign).toMatchObject({ name: input.name, memo: input.memo, basic_info: input.basic_info });
    expect(await makeStoreRepo(tx, B).getDeleteImpact(["store_368_b"])).toEqual({ deals: 1, handoffs: 1, store_research_runs: 1, place_candidates: 1 });
    const [candidate] = await makePlaceCandidateRepo(tx, B).findByGooglePlaceIds(["place_b"]);
    expect(candidate).toMatchObject({ seen_count: 1, matched_store_id: "store_368_b" });
    throw rollback;
  })).rejects.toBe(rollback);
}
function candidateInput(placeId: string, storeId?: string): UpsertPlaceCandidatesFromAreaSearchParams {
  return {
    places: [{ place: { placeId }, discovery: { sources: ["nearby"] }, matchedStore: storeId ? { id: storeId } : null, distanceMeters: 10, isWithinRadius: true }] as unknown as UpsertPlaceCandidatesFromAreaSearchParams["places"],
    keyword: "カフェ", area: "東京", center: { lat: 35.5, lng: 139.5 }, radiusMeters: 500,
  };
}

type IsolationCase = (fixture: Fixture) => Promise<void>;
const storeCases = {
  list: async ({ repo }) => {
    for (const filter of [{}, { q: "共通" }, { q: "見つからない" }, { stage: input.stage }]) {
      const rows = await repo.list(filter);
      expect(rows.every((row) => row.id === "store_368_a")).toBe(true);
      if (!('q' in filter) || filter.q === "共通") expect(rows).toHaveLength(1);
    }
  },
  get: async ({ repo }) => {
    expect(await repo.get("store_368_b")).toBeNull();
    expect(await repo.get("missing")).toBeNull();
    expect(await repo.get("store_368_a")).not.toBeNull();
  },
  getForUpdate: async ({ repo }) => {
    expect(await repo.getForUpdate("store_368_b")).toBeNull();
    expect(await repo.getForUpdate("store_368_a")).not.toBeNull();
  },
  create: async ({ repo, tx }) => {
    const created = await repo.create(input);
    const [row] = await tx.select().from(stores).where(eq(stores.id, created.id));
    expect(row?.tenant_id).toBe(A);
  },
  update: async ({ repo }) => {
    expect(await repo.update("store_368_b", { memo: "foreign update" })).toBeNull();
    expect(await repo.update("missing", { memo: "foreign update" })).toBeNull();
    expect(await repo.update("store_368_a", { memo: "updated" })).toMatchObject({ memo: "updated" });
  },
  delete: async ({ repo }) => {
    expect(await repo.delete("store_368_b")).toBe(false);
    expect(await repo.delete("store_368_a")).toBe(true);
  },
  bulkDelete: async ({ repo }) => {
    expect(await repo.bulkDelete([])).toBe(0);
    expect(await repo.bulkDelete(["store_368_a", "store_368_b", "missing"])).toBe(1);
  },
  getDeleteImpact: async ({ repo }) => {
    expect(await repo.getDeleteImpact(["store_368_b"])).toEqual(ZERO_IMPACT);
    expect(await repo.getDeleteImpact(["store_368_a", "store_368_b"])).toEqual({ deals: 1, handoffs: 1, store_research_runs: 1, place_candidates: 1 });
  },
  mergeBasicInfo: async ({ repo }) => {
    await expect(repo.mergeBasicInfo("store_368_b", {}, "manual")).rejects.toThrow("Store not found");
    expect((await repo.mergeBasicInfo("store_368_a", {}, "manual")).id).toBe("store_368_a");
  },
  findAreaSearchCandidates: async ({ repo }) => {
    const bounds = { minLat: 35, maxLat: 36, minLng: 139, maxLng: 140 };
    for (const params of [{ googlePlaceIds: ["shared-place"] }, { googlePlaceIds: [], bounds }, { googlePlaceIds: ["shared-place"], bounds }]) {
      expect((await repo.findAreaSearchCandidates(params)).map((row) => row.id)).toEqual(["store_368_a"]);
    }
  },
} satisfies Record<keyof StoreRepository, IsolationCase>;
const candidateCases = {
  findByGooglePlaceIds: async ({ candidates }) => {
    expect((await candidates.findByGooglePlaceIds(["place_a", "place_b"])).map((row) => row.google_place_id)).toEqual(["place_a"]);
    expect(await candidates.findByGooglePlaceIds([])).toEqual([]);
  },
  upsertFromAreaSearch: async ({ candidates, tx }) => {
    expect(await candidates.upsertFromAreaSearch(candidateInput("place_a"))).toMatchObject({ updatedCount: 1 });
    expect(await candidates.upsertFromAreaSearch(candidateInput("place_new"))).toMatchObject({ insertedCount: 1 });
    const [created] = await candidates.findByGooglePlaceIds(["place_new"]);
    expect(created).toMatchObject({ tenant_id: A });
    // google_place_id のグローバル一意制約は #371 まで残る。他社の行を更新せず安全に失敗する。
    await expect(tx.transaction((savepoint) => makePlaceCandidateRepo(savepoint, A).upsertFromAreaSearch(candidateInput("place_b")))).rejects.toThrow();
    await expect(candidates.upsertFromAreaSearch(candidateInput("invalid_match", "store_368_b"))).rejects.toThrow("店舗が見つかりません");
  },
} satisfies Record<keyof PlaceCandidateRepository, IsolationCase>;

describe("店舗 repository 全メソッドのテナント分離 (#368 / #369)", () => {
  it("対象表が空でなく、実メソッドをすべて含む", async () => {
    expect(Object.keys(storeCases).length).toBeGreaterThan(0);
    expect(Object.keys(candidateCases).length).toBeGreaterThan(0);
    await fixture(async ({ repo, candidates }) => {
      expect(Object.keys(storeCases).sort()).toEqual(Object.keys(repo).sort());
      expect(Object.keys(candidateCases).sort()).toEqual(Object.keys(candidates).sort());
    });
  });
  it.each(Object.entries(storeCases))("store.%s", async (_, run) => fixture(run));
  it.each(Object.entries(candidateCases))("placeCandidate.%s", async (_, run) => fixture(run));
  it("別テナントにだけ所属する担当者を拒否し、同じテナントの担当者は受け入れる", async () => {
    await fixture(async ({ tx, repo }) => {
      await tx.execute(sql`insert into auth.users (id, email, raw_user_meta_data) values (${USER_A}, 'a368@example.test', '{}'), (${USER_B}, 'b368@example.test', '{}')`);
      await tx.execute(sql`insert into memberships (tenant_id, user_id, role, created_at, updated_at) values (${A}, ${USER_A}, 'member', '2026-10-19', '2026-10-19'), (${B}, ${USER_B}, 'member', '2026-10-19', '2026-10-19')`);
      await expect(repo.create({ ...input, assigned_sales_user_id: USER_B })).rejects.toThrow("担当者");
      await expect(repo.update("store_368_a", { assigned_planner_user_id: USER_B })).rejects.toThrow("担当者");
      expect(await repo.update("store_368_a", { assigned_sales_user_id: USER_A })).toMatchObject({ assigned_sales_user_id: USER_A });
      expect(await repo.update("store_368_b", { assigned_sales_user_id: USER_A })).toBeNull();
    });
  });
});
