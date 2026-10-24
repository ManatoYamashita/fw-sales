import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ forTenant: vi.fn(), get: vi.fn(), update: vi.fn(), start: vi.fn(), getRun: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/tenant/context", () => ({ resolveTenantId: async () => "tenant-b" }));
vi.mock("@/lib/supabase/server", () => ({ getCurrentSession: async () => ({ userId: "user-b" }) }));
vi.mock("@/lib/repositories", () => ({ repos: { forTenant: mocks.forTenant } }));
vi.mock("workflow/api", () => ({ start: mocks.start, getRun: mocks.getRun }));
vi.mock("@/workflows/store-research", () => ({ storeResearchWorkflow: vi.fn() }));
vi.mock("@/lib/ai/research/availability", () => ({ getResearchAvailability: () => ({ available: true }) }));
vi.mock("@/lib/ai/rate-limiter", () => ({ checkRateLimit: () => ({ ok: true }) }));
vi.mock("@/lib/observability/audit", () => ({ writeAudit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidateTag: mocks.revalidateTag }));
import { startResearchRunAction, getResearchRunStatusAction, recordReviewDecisionAction, completeReviewAction, adoptBulkLaneAction } from "@/lib/actions/research-run-actions";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.get.mockResolvedValue(null);
  mocks.forTenant.mockImplementation((tenantId) => {
    expect(tenantId).toBe("tenant-b");
    const scoped = {
      store: { get: mocks.get },
      researchRun: { get: mocks.get, getForUpdate: mocks.get, update: mocks.update },
    };
    return { ...scoped, transaction: async (work: (tx: typeof scoped) => unknown) => work(scoped) };
  });
});
describe("調査Actionの他社ID", () => {
  it.each([
    ["起動", startResearchRunAction],
    ["進捗", getResearchRunStatusAction],
    ["項目レビュー", (id: string) => recordReviewDecisionAction({ runId: id, storeId: "store-b", itemKey: "phone", decision: "rejected" })],
    ["レビュー完了", (id: string) => completeReviewAction({ runId: id, storeId: "store-b", skipRemaining: true })],
    ["一括採用", (id: string) => adoptBulkLaneAction({ runId: id, storeId: "store-b", expectedKeys: ["phone"], complete: false })],
  ] as const)("%sは不存在と同じ応答で止まり、外部実行・更新・失効をしない", async (_, action) => {
    expect(await action("foreign-id")).toEqual(await action("missing-id"));
    expect(mocks.forTenant).toHaveBeenCalledWith("tenant-b");
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.getRun).not.toHaveBeenCalled();
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
  });
});
