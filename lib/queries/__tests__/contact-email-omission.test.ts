/**
 * 契約連絡先メール (#384) を表示しない画面へ、アドレスを渡さないこと。
 *
 * 一覧・パイプライン・ダッシュボード・AI 調査一覧のクエリは、結果をそのまま Client Component の
 * props にする (= ブラウザに届く)。アドレスを表示するのは店舗詳細と店舗編集だけなので、
 * 一覧系のクエリはアドレスを外し、店舗 1 件を読む `getStoreCached` は残す。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
}));
vi.mock("next/cache", () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));
vi.mock("@/lib/repositories", () => ({
  repos: {
    store: { list: mocks.list, get: mocks.get },
    handoff: { list: vi.fn().mockResolvedValue([]) },
    researchRun: { listStoreIdsNeedingReview: vi.fn().mockResolvedValue(["store_review"]) },
  },
}));

const { listStores, getStoreCached } = await import("../stores");
const { getPipelineColumns } = await import("../pipeline");
const { getActionQueue } = await import("../action-queue");
const { getResearchQueue } = await import("../research");

const STORES = [
  { id: "store_new", name: "未調査の店", stage: "未調査", updated_at: "2026-10-01", contact_email: "a@example.com" },
  { id: "store_review", name: "調査済みの店", stage: "調査済", updated_at: "2026-10-02", contact_email: "b@example.com" },
];

beforeEach(() => {
  mocks.list.mockResolvedValue(STORES.map((s) => ({ ...s })));
  mocks.get.mockResolvedValue({ ...STORES[0] });
});

function expectNoContactEmail(stores: readonly object[]) {
  expect(stores.length).toBeGreaterThan(0);
  for (const store of stores) expect(store).not.toHaveProperty("contact_email");
}

describe("一覧系のクエリはアドレスを外す", () => {
  it("店舗一覧 (listStores)", async () => {
    expectNoContactEmail(await listStores());
  });

  it("パイプライン (getPipelineColumns)", async () => {
    expectNoContactEmail((await getPipelineColumns()).flatMap((column) => column.stores));
  });

  it("ダッシュボード (getActionQueue)", async () => {
    expectNoContactEmail((await getActionQueue()).needsResearch);
  });

  it("AI 調査一覧 (getResearchQueue)", async () => {
    const queue = await getResearchQueue();
    expectNoContactEmail([...queue.needsReview, ...queue.waiting, ...queue.done]);
  });
});

describe("店舗 1 件のクエリ", () => {
  it("店舗詳細・店舗編集が使う getStoreCached はアドレスを残す", async () => {
    expect(await getStoreCached("store_new")).toMatchObject({ contact_email: "a@example.com" });
  });
});
