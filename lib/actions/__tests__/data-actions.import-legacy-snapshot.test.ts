/** #110の旧researchキーを無視し、現在の3 entityだけを所属付き移送へ渡す。 */
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ admin: vi.fn(), importSnapshot: vi.fn(), tag: vi.fn(), forTenant: vi.fn() }));
vi.mock("../_authz", () => ({ requireAdmin: mocks.admin }));
vi.mock("next/cache", () => ({ revalidateTag: mocks.tag }));
vi.mock("@/lib/tenant/context", () => ({ resolveTenantId: async () => "tenant-b" }));
vi.mock("@/lib/repositories", () => ({ repos: { forTenant: mocks.forTenant } }));
import { importJsonAction } from "../data-actions";
const current = { stores: [{ id: "store_001", name: "導楽" }], deals: [{ id: "deal_001", store_id: "store_001" }], handoffs: [{ id: "handoff_001", store_id: "store_001" }] };
const research = [{ id: "res_001", store_id: "store_001" }];
function form(payload: unknown) { const fd = new FormData(); fd.set("file", new File([JSON.stringify(payload)], "snapshot.json")); return fd; }
beforeEach(() => {
  vi.resetAllMocks();
  mocks.admin.mockResolvedValue({ ok: true, profile: { id: "user-b", email: "b@example.test" } });
  mocks.forTenant.mockImplementation((id) => { expect(id).toBe("tenant-b"); return { data: { importSnapshot: mocks.importSnapshot } }; });
});
describe("旧snapshotの互換性と所属", () => {
  it("researchキーがあっても現在の3 entityを受理する", async () => {
    expect(await importJsonAction(null, form({ ...current, research }))).toMatchObject({ ok: true });
  });
  it("旧researchを渡さず、3 entityだけを束縛した入口へ渡す", async () => {
    await importJsonAction(null, form({ ...current, research }));
    expect(mocks.importSnapshot).toHaveBeenCalledExactlyOnceWith(current);
  });
  it("researchだけなら書き込まない", async () => {
    expect(await importJsonAction(null, form({ research }))).toMatchObject({ ok: true });
    expect(mocks.forTenant).not.toHaveBeenCalled();
  });
  it("現行JSONを同じ入口へ渡す", async () => {
    await importJsonAction(null, form(current)); expect(mocks.importSnapshot).toHaveBeenCalledExactlyOnceWith(current);
  });
  it("取り込み失敗時はタグを失効せず、内部エラーを画面へ返さない", async () => {
    mocks.importSnapshot.mockRejectedValue(new Error("foreign tenant secret"));
    expect(await importJsonAction(null, form(current))).toMatchObject({ ok: false, error: expect.not.stringContaining("secret") });
    expect(mocks.tag).not.toHaveBeenCalled();
  });
});
