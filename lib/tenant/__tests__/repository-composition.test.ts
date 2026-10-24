import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const db = { transaction: vi.fn(async (work) => work("transaction-executor")) };
  const legacyFactory = vi.fn(() => ({}));
  const scopedFactory = () => vi.fn((executor, tenantId) => ({ executor, tenantId }));
  return { db, legacyFactory, makeStoreRepo: scopedFactory(), makePlaceCandidateRepo: scopedFactory(), makeDealRepo: scopedFactory(), makeHandoffRepo: scopedFactory(), makeResearchRunRepo: scopedFactory() };
});
vi.mock("@/lib/db", () => ({
  db: mocks.db,
  makeStoreRepo: mocks.makeStoreRepo,
  makePlaceCandidateRepo: mocks.makePlaceCandidateRepo,
  makeDealRepo: mocks.makeDealRepo, makeHandoffRepo: mocks.makeHandoffRepo,
  makeProfileRepo: mocks.legacyFactory, makeMembershipRepo: mocks.legacyFactory,
  makeNotificationRepo: mocks.legacyFactory, makePromptTemplateRepo: mocks.legacyFactory,
  makeAppSettingsRepo: mocks.legacyFactory, makeResearchRunRepo: mocks.makeResearchRunRepo,
  dbEventLogRepo: {}, dbProfileRepo: {},
  dbMembershipRepo: {}, dbNotificationRepo: {}, dbPromptTemplateRepo: {}, dbAppSettingsRepo: {},
}));
const { repos } = await import("@/lib/repositories");

describe("テナントを束縛した repository の構築", () => {
  it("通常 executor と transaction executor の両方に同じテナントを渡す", async () => {
    const scoped = repos.forTenant("tenant-a");
    for (const domain of ["store", "placeCandidate", "deal", "handoff", "researchRun"] as const) {
      expect(scoped[domain]).toEqual({ executor: mocks.db, tenantId: "tenant-a" });
      expect(repos.forTenant("tenant-b")[domain]).toEqual({ executor: mocks.db, tenantId: "tenant-b" });
    }
    await scoped.transaction(async (tx) => {
      for (const domain of ["store", "placeCandidate", "deal", "handoff", "researchRun"] as const) {
        expect(tx[domain]).toEqual({ executor: "transaction-executor", tenantId: "tenant-a" });
      }
    });
    expect(Object.isFrozen(scoped)).toBe(true);
  });
  it("移行済みの領域はテナントの無い入口を持たず、空のテナントは拒否する", async () => {
    for (const domain of ["store", "placeCandidate", "deal", "handoff", "researchRun"]) {
      expect(repos).not.toHaveProperty(domain);
    }
    await repos.transaction(async (tx) => {
      expect(tx).not.toHaveProperty("deal");
      expect(tx).not.toHaveProperty("handoff");
      expect(tx).not.toHaveProperty("researchRun");
    });
    expect(() => repos.forTenant(" ")).toThrow("テナント");
  });
});
