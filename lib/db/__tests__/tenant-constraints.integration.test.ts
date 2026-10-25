/** #371: applicationのguardを経由せず、実Postgres自身が境界を守ることを確認する。 */
import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db, type Tx } from "@/lib/db/client";
import { tenants, memberships, stores, deals, handoffs, storeResearchRuns, placeCandidates, notifications, aiPromptTemplates, appSettings, eventLogs } from "@/lib/db/schema";
import { SEED_STORES, SEED_DEALS, SEED_HANDOFFS } from "@/lib/db/seed-data";
import { toDbRow } from "@/lib/db/store-repository";
import { makeAppSettingsRepo } from "@/lib/db/app-settings-repository";
import { makePlaceCandidateRepo } from "@/lib/db/place-candidate-repository";

const A = "f3710000-0000-4000-8000-000000000001", B = "f3710000-0000-4000-8000-000000000002";
const U = "f3710000-0000-4000-8000-00000000000a";
const now = "2026-10-25";
const store = (id: string) => ({ ...toDbRow(SEED_STORES[0]!), id });
const deal = (id: string, storeId: string) => ({ ...SEED_DEALS[0]!, id, store_id: storeId });
const handoff = (id: string, storeId: string, dealId: string) => ({ ...SEED_HANDOFFS[0]!, id, store_id: storeId, deal_id: dealId });
const run = (id: string, storeId: string) => ({ id, store_id: storeId, status: "succeeded", started_at: `${now}T00:00:00Z`, expires_at: `${now}T01:00:00Z` });
const candidate = (id: string, storeId: string) => ({ id, google_place_id: `place_${id}`, matched_store_id: storeId, first_seen_at: now, last_seen_at: now, created_at: now, updated_at: now });

async function snapshot(tx: Tx, tenant: string) {
  return {
    stores: await tx.select().from(stores).where(eq(stores.tenant_id, tenant)).orderBy(stores.id),
    deals: await tx.select().from(deals).where(eq(deals.tenant_id, tenant)).orderBy(deals.id),
    handoffs: await tx.select().from(handoffs).where(eq(handoffs.tenant_id, tenant)).orderBy(handoffs.id),
    runs: await tx.select().from(storeResearchRuns).where(eq(storeResearchRuns.tenant_id, tenant)).orderBy(storeResearchRuns.id),
    candidates: await tx.select().from(placeCandidates).where(eq(placeCandidates.tenant_id, tenant)).orderBy(placeCandidates.id),
  };
}
async function fixture(work: (tx: Tx) => Promise<void>) {
  const rollback = new Error("rollback contract fixture");
  await expect(db.transaction(async tx => {
    await tx.insert(tenants).values([A, B].map((id, i) => ({ id, slug: `contract-${i}`, name: id, created_at: now, updated_at: now })));
    await tx.execute(sql`insert into auth.users(id,email,raw_user_meta_data) values (${U},'contract@example.test','{}')`);
    await tx.insert(memberships).values([A, B].map(tenant_id => ({ tenant_id, user_id: U, role: "admin", created_at: now, updated_at: now })));
    for (const [tenant, suffix] of [[A,"a"],[B,"b"]]) {
      await tx.insert(stores).values({ ...store(`contract_s_${suffix}`), tenant_id: tenant! });
      await tx.insert(deals).values({ ...deal(`contract_d_${suffix}`, `contract_s_${suffix}`), tenant_id: tenant! });
      await tx.insert(handoffs).values({ ...handoff(`contract_h_${suffix}`, `contract_s_${suffix}`, `contract_d_${suffix}`), tenant_id: tenant! });
      await tx.insert(storeResearchRuns).values({ ...run(`contract_r_${suffix}`, `contract_s_${suffix}`), tenant_id: tenant! });
      await tx.insert(placeCandidates).values({ ...candidate(`contract_c_${suffix}`, `contract_s_${suffix}`), tenant_id: tenant! });
    }
    await work(tx);
    throw rollback;
  })).rejects.toBe(rollback);
}

const missingTenant = [
  ["stores", stores, store("missing-tenant")],
  ["deals", deals, deal("missing-tenant", "contract_s_a")],
  ["handoffs", handoffs, handoff("missing-tenant", "contract_s_a", "contract_d_a")],
  ["store_research_runs", storeResearchRuns, run("missing-tenant", "contract_s_a")],
  ["place_candidates", placeCandidates, candidate("missing-tenant", "contract_s_a")],
  ["notifications", notifications, { id: "missing-tenant", user_id: U, kind: "test", title: "test", body: "test", created_at: now, updated_at: now }],
  ["ai_prompt_templates", aiPromptTemplates, { user_id: U, name: "test", body: "test", created_at: now, updated_at: now }],
  ["app_settings", appSettings, { key: "missing-tenant", value: "test", updated_at: now }],
  ["event_logs", eventLogs, { id: "missing-tenant", level: "info", kind: "mutation", event: "test", target_type: "store", payload: {} }],
] as const;

describe("DEFAULTなしと複合FKをDB自身が強制する", () => {
  it.each(missingTenant)("%sはtenant_idの省略を23502で拒否", async (_, table, row) => fixture(async tx => {
    // 不正なpayloadを意図して型境界の外から送る。DBのDEFAULTへ補完されてはいけない。
    await expect(tx.transaction(inner => inner.insert(table).values(row as never))).rejects.toMatchObject({ cause: { code: "23502", column_name: "tenant_id" } });
  }));
  const invalidReferences = [
    ["deals", (tx: Tx) => tx.insert(deals).values({ ...deal("foreign-deal", "contract_s_a"), tenant_id: B })],
    ["handoffs.store", (tx: Tx) => tx.insert(handoffs).values({ ...handoff("foreign-handoff", "contract_s_a", "contract_d_b"), tenant_id: B })],
    ["handoffs.deal", (tx: Tx) => tx.insert(handoffs).values({ ...handoff("foreign-handoff", "contract_s_b", "contract_d_a"), tenant_id: B })],
    ["research", (tx: Tx) => tx.insert(storeResearchRuns).values({ ...run("foreign-run", "contract_s_a"), tenant_id: B })],
    ["candidate", (tx: Tx) => tx.insert(placeCandidates).values({ ...candidate("foreign-candidate", "contract_s_a"), tenant_id: B })],
  ] as const;
  it.each(invalidReferences)("%sの越境INSERTを23503で拒否し、両社を変更しない", async (_, insert) => fixture(async tx => {
    const beforeA = await snapshot(tx,A), beforeB = await snapshot(tx,B);
    await expect(tx.transaction(inner => insert(inner))).rejects.toMatchObject({ cause: { code: "23503" } });
    expect(await snapshot(tx,A)).toEqual(beforeA); expect(await snapshot(tx,B)).toEqual(beforeB);
  }));
  it("所属だけを書き換えるUPDATEも親参照があれば拒否する", async () => fixture(async tx => {
    await expect(tx.transaction(inner => inner.update(deals).set({ tenant_id: B }).where(eq(deals.id,"contract_d_a")))).rejects.toMatchObject({ cause: { code: "23503" } });
  }));
  it("削除は自社の子だけCASCADEし、候補は所属を保持して参照列だけNULL", async () => fixture(async tx => {
    const other = await snapshot(tx,B);
    await tx.delete(stores).where(eq(stores.id,"contract_s_a"));
    expect(await snapshot(tx,A)).toMatchObject({ stores: [], deals: [], handoffs: [], runs: [], candidates: [expect.objectContaining({ tenant_id:A, matched_store_id:null })] });
    expect(await snapshot(tx,B)).toEqual(other);
  }));
  it("同じPlace IDを2社が保存し、repositoryも自社の候補だけを読む", async () => fixture(async tx => {
    await tx.update(placeCandidates).set({ google_place_id:"shared-place" });
    for (const [tenant,suffix] of [[A,"a"],[B,"b"]]) {
      expect((await makePlaceCandidateRepo(tx,tenant!).findByGooglePlaceIds(["shared-place"])).map(row => row.id)).toEqual([`contract_c_${suffix}`]);
    }
    await expect(tx.transaction(inner => inner.insert(placeCandidates).values({ ...candidate("duplicate","contract_s_a"),google_place_id:"shared-place",tenant_id:A }))).rejects.toMatchObject({ cause: { code:"23505" } });
  }));
  it("同名の設定を2社が独立して保存・更新する", async () => fixture(async tx => {
    const a=makeAppSettingsRepo(tx,A), b=makeAppSettingsRepo(tx,B);
    await a.set("shared","A"); await b.set("shared","B"); await a.set("shared","A updated");
    expect(await a.get("shared")).toBe("A updated"); expect(await b.get("shared")).toBe("B");
  }));
  it("兼務者は各社で既定1件・最大5件を保持し、6件目と所属移動を拒否", async () => fixture(async tx => {
    for (const tenant of [A,B]) for (let i=0;i<5;i++) await tx.insert(aiPromptTemplates).values({ tenant_id:tenant,user_id:U,name:`template-${i}`,body:"body",is_default:i===0,created_at:now,updated_at:now });
    expect((await tx.select().from(aiPromptTemplates)).filter(row => row.user_id===U)).toHaveLength(10);
    for (const tenant of [A,B]) await expect(tx.transaction(inner=>inner.insert(aiPromptTemplates).values({ tenant_id:tenant,user_id:U,name:"sixth",body:"body",created_at:now,updated_at:now }))).rejects.toMatchObject({ cause: { code: "P0001", message: expect.stringContaining("最大5件") } });
    const [one] = await tx.select().from(aiPromptTemplates).where(eq(aiPromptTemplates.tenant_id,A));
    await expect(tx.transaction(inner=>inner.update(aiPromptTemplates).set({ tenant_id:B }).where(eq(aiPromptTemplates.id,one!.id)))).rejects.toMatchObject({ cause: { code: "P0001", message: expect.stringContaining("最大5件") } });
  }));
  it("所属を外しても担当者・依頼者の履歴を残し、他社の所属に影響しない", async () => fixture(async tx => {
    await tx.update(stores).set({ assigned_sales_user_id:U }).where(eq(stores.id,"contract_s_a"));
    await tx.update(storeResearchRuns).set({ requested_by_user_id:U }).where(eq(storeResearchRuns.id,"contract_r_a"));
    await tx.delete(memberships).where(eq(memberships.tenant_id,A));
    expect((await snapshot(tx,A)).stores[0]?.assigned_sales_user_id).toBe(U);
    expect((await snapshot(tx,A)).runs[0]?.requested_by_user_id).toBe(U);
    expect(await tx.select().from(memberships).where(eq(memberships.tenant_id,B))).toHaveLength(1);
  }));
});
