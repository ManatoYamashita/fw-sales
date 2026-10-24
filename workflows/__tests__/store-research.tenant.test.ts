import { beforeEach, describe, expect, it, vi } from "vitest";
import { FatalError } from "workflow";
import { SEED_STORES } from "@/lib/db/seed-data";

const mocks = vi.hoisted(() => ({ tenant: "tenant-b", forTenant: vi.fn(), get: vi.fn(), updateIfRunning: vi.fn(), stage0: vi.fn(), stage1: vi.fn() }));
vi.mock("@/lib/repositories", () => ({ repos: { forTenant: mocks.forTenant } }));
vi.mock("@/lib/tenant/context", () => ({ resolveTenantId: () => { throw new Error("Workflow内でリクエストのテナントを解決しない"); } }));
vi.mock("@/lib/ai/research/places-stage0", () => ({ runStage0PlacesResync: mocks.stage0 }));
vi.mock("@/lib/ai/research/pipeline", async (original) => ({ ...await original<object>(), runStage1: mocks.stage1 }));
import { storeResearchWorkflow } from "@/workflows/store-research";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.forTenant.mockImplementation((tenantId) => {
    expect(tenantId).toBe(mocks.tenant);
    return { store: { get: mocks.get }, researchRun: { updateIfRunning: mocks.updateIfRunning } };
  });
  mocks.get.mockResolvedValue({ ...SEED_STORES[0]!, id: "store-b", google_place_id: null });
  mocks.updateIfRunning.mockResolvedValue({ id: "run-b" });
  mocks.stage0.mockResolvedValue({ placesBasicInfo: {}, diagnostic: {}, verifiedIdentity: null });
  mocks.stage1.mockRejectedValue(new FatalError("controlled stage failure"));
});

describe("Workflowのテナント引き継ぎ", () => {
  it("読取・進捗・失敗記録に起動時のテナントを使う", async () => {
    await expect(storeResearchWorkflow("run-b", "store-b", mocks.tenant)).rejects.toBeInstanceOf(FatalError);
    expect(mocks.get).toHaveBeenCalledWith("store-b");
    expect(mocks.updateIfRunning).toHaveBeenCalledWith("run-b", { stage: "discovering" });
    expect(mocks.updateIfRunning).toHaveBeenCalledWith("run-b", expect.objectContaining({ status: "failed" }));
    expect(mocks.forTenant).toHaveBeenCalledTimes(3);
    expect(mocks.stage1).toHaveBeenCalledOnce();
  });
  it("自分のテナントにない店舗は外部調査へ進めない", async () => {
    mocks.get.mockResolvedValue(null);
    await expect(storeResearchWorkflow("foreign-run", "foreign-store", mocks.tenant)).rejects.toThrow("店舗が見つかりません");
    expect(mocks.stage0).not.toHaveBeenCalled();
    expect(mocks.stage1).not.toHaveBeenCalled();
  });
  it("CASが0件なら外部調査へ進めず、終了状態を上書きしない", async () => {
    mocks.updateIfRunning.mockResolvedValue(null);
    await expect(storeResearchWorkflow("foreign-run", "store-b", mocks.tenant)).rejects.toThrow("superseded");
    expect(mocks.updateIfRunning).toHaveBeenCalledTimes(2);
    expect(mocks.updateIfRunning).toHaveBeenLastCalledWith("foreign-run", expect.objectContaining({ status: "failed" }));
    expect(mocks.stage0).not.toHaveBeenCalled();
  });
  it.each(["", undefined])("テナントのない古い引数を補完しない: %s", async (tenantId) => {
    await expect(storeResearchWorkflow("run-b", "store-b", tenantId as string)).rejects.toThrow("テナント");
    expect(mocks.forTenant).not.toHaveBeenCalled();
    expect(mocks.stage0).not.toHaveBeenCalled();
  });
});
