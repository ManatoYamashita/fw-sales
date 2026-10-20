import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const db = { transaction: vi.fn(async (work) => work("transaction-executor")) };
  const legacyFactory = vi.fn(() => ({}));
  return { db, legacyFactory, makeStoreRepo: vi.fn((executor, tenantId) => ({ executor, tenantId })), makePlaceCandidateRepo: vi.fn((executor, tenantId) => ({ executor, tenantId })) };
});
vi.mock("@/lib/db", () => ({
  db: mocks.db,
  makeStoreRepo: mocks.makeStoreRepo,
  makePlaceCandidateRepo: mocks.makePlaceCandidateRepo,
  makeDealRepo: mocks.legacyFactory, makeHandoffRepo: mocks.legacyFactory,
  makeProfileRepo: mocks.legacyFactory, makeMembershipRepo: mocks.legacyFactory,
  makeNotificationRepo: mocks.legacyFactory, makePromptTemplateRepo: mocks.legacyFactory,
  makeAppSettingsRepo: mocks.legacyFactory, makeResearchRunRepo: mocks.legacyFactory,
  dbEventLogRepo: {}, dbDealRepo: {}, dbHandoffRepo: {}, dbProfileRepo: {},
  dbMembershipRepo: {}, dbNotificationRepo: {}, dbPromptTemplateRepo: {}, dbAppSettingsRepo: {}, dbResearchRunRepo: {},
}));
const { repos } = await import("@/lib/repositories");

describe("テナントを束縛した repository の構築", () => {
  it("通常 executor と transaction executor の両方に同じテナントを渡す", async () => {
    const scoped = repos.forTenant("tenant-a");
    expect(scoped.store).toEqual({ executor: mocks.db, tenantId: "tenant-a" });
    expect(scoped.placeCandidate).toEqual({ executor: mocks.db, tenantId: "tenant-a" });
    await scoped.transaction(async (tx) => {
      expect(tx.store).toEqual({ executor: "transaction-executor", tenantId: "tenant-a" });
      expect(tx.placeCandidate).toEqual({ executor: "transaction-executor", tenantId: "tenant-a" });
    });
    expect(repos.forTenant("tenant-b").store).toEqual({ executor: mocks.db, tenantId: "tenant-b" });
    expect(Object.isFrozen(scoped)).toBe(true);
  });
  it("テナントの無い店舗入口を持たず、空のテナントは拒否する", () => {
    expect(repos).not.toHaveProperty("store");
    expect(repos).not.toHaveProperty("placeCandidate");
    expect(() => repos.forTenant(" ")).toThrow("テナント");
  });
});
