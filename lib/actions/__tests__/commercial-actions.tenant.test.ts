import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Deal } from "@/types/deal";
import type { Handoff } from "@/types/handoff";
import { SEED_DEALS, SEED_HANDOFFS, SEED_STORES } from "@/lib/db/seed-data";

const mocks = vi.hoisted(() => ({
  tenantId: "tenant-b", forTenant: vi.fn(), transaction: vi.fn(), member: vi.fn(),
  store: { get: vi.fn(), update: vi.fn() },
  deal: { get: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  handoff: { get: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  updateTag: vi.fn(), revalidateTag: vi.fn(), redirect: vi.fn(),
}));
vi.mock("@/lib/tenant/context", () => ({ resolveTenantId: async () => mocks.tenantId }));
vi.mock("@/lib/supabase/server", () => ({ getCurrentProfile: async () => ({ id: "user-b", role: "admin", email: "b@example.test" }) }));
vi.mock("@/lib/repositories", () => ({ repos: {
  forTenant: mocks.forTenant,
  // 未束縛の商談・引き継ぎ入口は mock にも持たせない。
} }));
vi.mock("next/cache", () => ({ updateTag: mocks.updateTag, revalidateTag: mocks.revalidateTag }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import { createDealAction, updateDealAction, deleteDealAction, deleteSalesActivityAction } from "@/lib/actions/deal-actions";
import { createHandoffAction, updateHandoffAction, completeHandoffAction, deleteHandoffAction } from "@/lib/actions/handoff-actions";

const ownDeal: Deal = { ...SEED_DEALS[0]!, id: "own-deal", store_id: "own-store", assigned_sales_user_id: null };
const ownHandoff: Handoff = { ...SEED_HANDOFFS[0]!, id: "own-handoff", deal_id: ownDeal.id, store_id: ownDeal.store_id };
beforeEach(() => {
  Object.values(mocks).forEach((value) => { if (vi.isMockFunction(value)) value.mockReset(); });
  for (const domain of [mocks.store, mocks.deal, mocks.handoff]) Object.values(domain).forEach((fn) => fn.mockReset());
  mocks.forTenant.mockImplementation((tenantId) => {
    expect(tenantId).toBe(mocks.tenantId);
    return { membership: { find: mocks.member }, store: mocks.store, deal: mocks.deal, handoff: mocks.handoff, transaction: mocks.transaction };
  });
  mocks.transaction.mockImplementation(async (work) => work({ store: mocks.store, deal: mocks.deal, handoff: mocks.handoff }));
  mocks.store.get.mockImplementation(async (id) => id === "own-store" ? { ...SEED_STORES[0]!, id, stage: "架電済み", assigned_sales_user_id: null } : null);
  mocks.deal.get.mockImplementation(async (id) => id === ownDeal.id ? ownDeal : null);
  mocks.handoff.get.mockImplementation(async (id) => id === ownHandoff.id ? ownHandoff : null);
  mocks.deal.create.mockResolvedValue(ownDeal);
  mocks.deal.update.mockResolvedValue(ownDeal);
  mocks.handoff.create.mockResolvedValue(ownHandoff);
  mocks.handoff.update.mockResolvedValue(ownHandoff);
  mocks.member.mockImplementation(async (id) => id === "user-b" ? { id } : null);
});

describe("商談Actionのテナント伝播", () => {
  it.each([
    ["商談作成", (id: string) => createDealAction(id, null, new FormData())],
    ["商談更新", (id: string) => updateDealAction(id, null, new FormData())],
    ["商談削除", deleteDealAction], ["営業記録削除", deleteSalesActivityAction],
    ["引き継ぎ作成", (id: string) => createHandoffAction(id, null, new FormData())],
    ["引き継ぎ更新", (id: string) => updateHandoffAction(id, null, new FormData())],
    ["引き継ぎ完了", completeHandoffAction], ["引き継ぎ削除", deleteHandoffAction],
  ] as const)("%sは他社IDを不存在と同じ応答にする", async (_, action) => {
    expect(await action("foreign-id")).toEqual(await action("missing-id"));
    expect(mocks.forTenant).toHaveBeenCalledWith(mocks.tenantId);
    expect(mocks.transaction).not.toHaveBeenCalled();
    for (const domain of [mocks.deal, mocks.handoff]) {
      expect(domain.create).not.toHaveBeenCalled();
      expect(domain.update).not.toHaveBeenCalled();
      expect(domain.delete).not.toHaveBeenCalled();
    }
    expect(mocks.updateTag).not.toHaveBeenCalled();
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
  });

  it("営業担当は現在のテナントの所属で検証する", async () => {
    const input = new FormData();
    input.set("assigned_sales_user_id", "foreign-user");
    expect(await createDealAction("own-store", null, input)).toMatchObject({ ok: false, error: "営業担当が見つかりませんでした" });
    expect(await updateDealAction(ownDeal.id, null, input)).toMatchObject({ ok: false, error: "営業担当が見つかりませんでした" });
    expect(mocks.member).toHaveBeenCalledWith("foreign-user");
    expect(mocks.deal.create).not.toHaveBeenCalled();
    expect(mocks.deal.update).not.toHaveBeenCalled();
    input.set("assigned_sales_user_id", "user-b");
    expect(await createDealAction("own-store", null, input)).toMatchObject({ ok: true });
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.updateTag).toHaveBeenCalledWith("tenant:tenant-b:deals");
  });

  it("引き継ぎの作成・完了を同じテナントのtransactionで処理する", async () => {
    expect(await createHandoffAction(ownDeal.id, null, new FormData())).toMatchObject({ ok: true });
    expect(await completeHandoffAction(ownHandoff.id)).toMatchObject({ ok: true });
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
    expect(mocks.store.update).toHaveBeenCalledWith("own-store", { stage: "架電済み" });
    expect(mocks.handoff.update).toHaveBeenCalledWith(ownHandoff.id, { status: "完了" });
    const invalidated = mocks.revalidateTag.mock.calls.map(([tag]) => tag);
    expect(invalidated.length).toBeGreaterThan(0);
    expect(invalidated.every((tag) => tag.startsWith("tenant:tenant-b:"))).toBe(true);
  });
});
