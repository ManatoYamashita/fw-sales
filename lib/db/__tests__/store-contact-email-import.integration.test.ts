/**
 * 契約連絡先メール (#384) とテナント単位のデータ移送 (#395) の実DB検証。
 * Server Action (`importJsonAction` / `clearAllAction` / `resetToSeedAction`) から
 * `makeDataRepo` までを mock せずに通し、各ケースを rollback する。
 *
 * 確かめること:
 * - `contact_email` の無い旧 JSON を再インポートしても、保存済みのアドレスが残る
 * - メモなど別の項目だけを変える JSON でも、アドレスが消えない
 * - 他テナントの店舗 ID を指定したインポートは失敗し、他テナントの行 (アドレスを含む) は変わらない
 * - 不正なアドレスを含むインポートは、トランザクションを始める前に断り、何も書かない
 * - Reset・Clear は他テナントの行 (アドレスを含む) に触れない
 *
 * 他テナント (A) の全列は、各ケースの前後で一致することを fixture が確かめる。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db, type DbClient, type Tx } from "@/lib/db/client";
import { makeDataRepo } from "@/lib/db/data-repository";
import { makeStoreRepo, toDbRow } from "@/lib/db/store-repository";
import { makeDealRepo } from "@/lib/db/deal-repository";
import { makeHandoffRepo } from "@/lib/db/handoff-repository";
import { stores, deals, handoffs, tenants, memberships } from "@/lib/db/schema";
import { SEED_STORES } from "@/lib/db/seed-data";

const A = "f3840000-0000-4000-8000-000000000001", B = "f3840000-0000-4000-8000-000000000002";
const UA = "f3840000-0000-4000-8000-00000000000a", UB = "f3840000-0000-4000-8000-00000000000b";
const SA = "contact_store_a", SB = "contact_store_b";
const MAIL_A = "tenant-a@example.test", MAIL_B = "tenant-b@example.test";
const ctx = vi.hoisted(() => ({ tx: null as unknown, transactions: 0 }));
vi.mock("@/lib/tenant/context", () => ({ resolveTenantId: async () => "f3840000-0000-4000-8000-000000000002" }));
vi.mock("@/lib/supabase/server", () => ({ getCurrentProfile: async () => ({ id: "f3840000-0000-4000-8000-00000000000b", role: "admin", email: "contact-b@example.test" }) }));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));
vi.mock("@/lib/repositories", () => ({ repos: { forTenant: (id: string) => {
  expect(id).toBe(B);
  const tx = ctx.tx as Tx;
  return { data: makeDataRepo(transactional(tx), id), store: makeStoreRepo(tx, id), deal: makeDealRepo(tx, id), handoff: makeHandoffRepo(tx, id) };
} } }));
import { importJsonAction, clearAllAction, resetToSeedAction } from "@/lib/actions/data-actions";

/** data repository が始めるトランザクションを数える (不正な入力で 0 回のままであることを確かめる)。 */
function transactional(tx: Tx): DbClient {
  return { transaction: (work: (inner: Tx) => Promise<unknown>) => { ctx.transactions += 1; return tx.transaction(work); } } as unknown as DbClient;
}
function store(id: string, extra: Record<string, unknown> = {}) { return { ...SEED_STORES[0]!, id, ...extra }; }
function form(payload: unknown) { const fd = new FormData(); fd.set("file", new File([JSON.stringify(payload)], "snapshot.json")); return fd; }
async function rows(tx: Tx, tenantId: string) {
  return {
    stores: await tx.select().from(stores).where(eq(stores.tenant_id, tenantId)).orderBy(stores.id),
    deals: await tx.select().from(deals).where(eq(deals.tenant_id, tenantId)).orderBy(deals.id),
    handoffs: await tx.select().from(handoffs).where(eq(handoffs.tenant_id, tenantId)).orderBy(handoffs.id),
  };
}
async function storeB(tx: Tx) {
  const [row] = await tx.select().from(stores).where(eq(stores.id, SB));
  return row!;
}

async function fixture(work: (tx: Tx) => Promise<void>) {
  const rollback = new Error("rollback contact email fixture");
  await expect(db.transaction(async (tx) => {
    ctx.tx = tx;
    await tx.insert(tenants).values([A, B].map((id, i) => ({ id, slug: `contact-384-${i}`, name: id, created_at: "2026-11-04", updated_at: "2026-11-04" })));
    await tx.execute(sql`insert into auth.users(id,email,raw_user_meta_data) values (${UA},'contact-a@example.test','{}'),(${UB},'contact-b@example.test','{}')`);
    await tx.insert(memberships).values([A, B].map((id, i) => ({ tenant_id: id, user_id: i ? UB : UA, role: "admin", created_at: "2026-11-04", updated_at: "2026-11-04" })));
    await tx.insert(stores).values({ ...toDbRow(store(SA, { contact_email: MAIL_A, memo: "A のメモ" })), tenant_id: A });
    await tx.insert(stores).values({ ...toDbRow(store(SB, { contact_email: MAIL_B, memo: "B のメモ" })), tenant_id: B });
    for (const table of ["stores", "deals", "handoffs"]) await tx.execute(sql.raw(`alter table ${table} alter column tenant_id drop default`));
    const beforeA = await rows(tx, A);
    expect(beforeA.stores[0]?.contact_email).toBe(MAIL_A);
    ctx.transactions = 0;
    await work(tx);
    expect(await rows(tx, A)).toEqual(beforeA);
    throw rollback;
  })).rejects.toBe(rollback);
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubEnv("ALLOW_DATA_RESET", "1"); vi.stubEnv("VERCEL_ENV", "development");
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("契約連絡先メールのインポート (#384 × #395、実DB)", () => {
  it("contact_email の無い旧 JSON を再インポートしても、保存済みのアドレスが残る", async () => fixture(async (tx) => {
    const legacy = { ...store(SB, { memo: "B のメモ" }) } as Record<string, unknown>;
    delete legacy.contact_email;
    expect(await importJsonAction(null, form({ stores: [legacy] }))).toMatchObject({ ok: true });
    expect(ctx.transactions).toBe(1);
    expect((await storeB(tx)).contact_email).toBe(MAIL_B);
  }));

  it("メモだけを変える JSON でも、アドレスは消えない", async () => fixture(async (tx) => {
    const legacy = { ...store(SB, { memo: "メモだけ変えた" }) } as Record<string, unknown>;
    delete legacy.contact_email;
    expect(await importJsonAction(null, form({ stores: [legacy] }))).toMatchObject({ ok: true });
    const row = await storeB(tx);
    expect(row.memo).toBe("メモだけ変えた");
    expect(row.contact_email).toBe(MAIL_B);
  }));

  it("キーがあれば正規化して保存し、空文字は明示的な削除として扱う", async () => fixture(async (tx) => {
    expect(await importJsonAction(null, form({ stores: [store(SB, { contact_email: "  new-b@example.test " })] }))).toMatchObject({ ok: true });
    expect((await storeB(tx)).contact_email).toBe("new-b@example.test");
    expect(await importJsonAction(null, form({ stores: [store(SB, { contact_email: "" })] }))).toMatchObject({ ok: true });
    expect((await storeB(tx)).contact_email).toBe("");
  }));

  it("他テナントの店舗 ID を指定したインポートは失敗し、自社の先行した変更も含めて何も変わらない", async () => fixture(async (tx) => {
    const beforeB = await rows(tx, B);
    const result = await importJsonAction(null, form({ stores: [
      store(SB, { memo: "先行した自社の変更", contact_email: "must-rollback@example.test" }),
      store(SA, { memo: "他社を上書き", contact_email: "attacker@example.test" }),
    ] }));
    expect(result).toMatchObject({ ok: false });
    expect(await rows(tx, B)).toEqual(beforeB);
  }));

  it("不正なアドレスを含むインポートは、トランザクションを始めずに断り、何も書かない", async () => fixture(async (tx) => {
    const beforeB = await rows(tx, B);
    const result = await importJsonAction(null, form({ stores: [
      store(SB, { memo: "書かれてはいけない" }),
      store("contact_store_new", { contact_email: "broken@@example.test" }),
    ] }));
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("2件目") });
    if (!result.ok) expect(result.error).not.toContain("broken");
    expect(ctx.transactions).toBe(0);
    expect(await rows(tx, B)).toEqual(beforeB);
  }));

  it("Clear は自社の行だけを消し、他テナントのアドレスに触れない", async () => fixture(async (tx) => {
    expect(await clearAllAction()).toMatchObject({ ok: true });
    expect((await rows(tx, B)).stores).toEqual([]);
  }));

  it("Reset は自社をシードに戻し (アドレスは未登録)、他テナントのアドレスに触れない", async () => fixture(async (tx) => {
    expect(await resetToSeedAction()).toMatchObject({ ok: true });
    const after = await rows(tx, B);
    expect(after.stores.length).toBeGreaterThan(0);
    expect(after.stores.every((s) => s.tenant_id === B && s.contact_email === "")).toBe(true);
  }));
});
