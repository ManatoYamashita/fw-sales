import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const db = { transaction: vi.fn(async (work) => work("transaction-executor")) };
  const factory = vi.fn((executor, tenantId) => ({ executor, tenantId }));
  return { db, auditDb: { dedicated: true }, factory };
});
vi.mock("@/lib/db", () => ({
  db: mocks.db, auditDb: mocks.auditDb,
  makeDataRepo: mocks.factory,
  makeStoreRepo: mocks.factory, makePlaceCandidateRepo: mocks.factory,
  makeDealRepo: mocks.factory, makeHandoffRepo: mocks.factory, makeResearchRunRepo: mocks.factory,
  makeProfileRepo: mocks.factory, makeMembershipRepo: mocks.factory,
  makeNotificationRepo: mocks.factory, makePromptTemplateRepo: mocks.factory,
  makeAppSettingsRepo: mocks.factory, makeEventLogRepo: mocks.factory,
}));
const { repos } = await import("@/lib/repositories");
const domains = ["store", "placeCandidate", "deal", "handoff", "researchRun", "profile", "membership", "notification", "promptTemplate", "appSettings"] as const;

describe("テナントを束縛したrepositoryの構築", () => {
  it("A/Bと通常/transactionの全repositoryがそれぞれの所属と接続を保つ", async () => {
    const a = repos.forTenant("tenant-a"), b = repos.forTenant("tenant-b");
    for (const domain of domains) {
      expect(a[domain]).toEqual({ executor: mocks.db, tenantId: "tenant-a" });
      expect(b[domain]).toEqual({ executor: mocks.db, tenantId: "tenant-b" });
    }
    for (const [tenantId, scoped] of [["tenant-a", a], ["tenant-b", b]] as const) {
      await scoped.transaction(async (tx) => {
        expect(Object.keys(tx).sort()).toEqual([...domains].sort());
        for (const domain of domains) expect(tx[domain]).toEqual({ executor: "transaction-executor", tenantId });
      });
      expect(Object.keys(scoped).sort()).toEqual([...domains, "data", "eventLog", "transaction"].sort());
      expect(scoped.data).toEqual({ executor: mocks.db, tenantId });
      expect(scoped.eventLog).toEqual({ executor: mocks.auditDb, tenantId });
      expect(Object.isFrozen(scoped)).toBe(true);
    }
  });
  it("root入口はforTenantだけで、空の所属は拒否する", () => {
    expect(Object.keys(repos)).toEqual(["forTenant"]);
    expect(() => repos.forTenant(" ")).toThrow("テナント");
  });
});
