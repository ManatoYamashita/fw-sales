/**
 * `getSnapshotForExportAction` は全件 (契約連絡先メールを含む) を返すため、
 * ログインしていない呼び出しには DB を読まずに断る (#384 のレビュー)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  getCurrentProfile: vi.fn(),
  storeList: vi.fn(),
  dealList: vi.fn(),
  handoffList: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ getCurrentProfile: mocks.getCurrentProfile }));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));
vi.mock("@/lib/repositories", () => ({
  repos: {
    forTenant: () => ({
      store: { list: mocks.storeList },
      deal: { list: mocks.dealList },
      handoff: { list: mocks.handoffList },
    }),
  },
}));

const { getSnapshotForExportAction } = await import("../data-actions");

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.storeList.mockResolvedValue([{ id: "store_1", contact_email: "a@example.com" }]);
  mocks.dealList.mockResolvedValue([]);
  mocks.handoffList.mockResolvedValue([]);
});

describe("getSnapshotForExportAction", () => {
  it("ログインしていなければ、DB を読まずに断る", async () => {
    mocks.getCurrentProfile.mockResolvedValue(null);
    await expect(getSnapshotForExportAction()).rejects.toThrow();
    expect(mocks.storeList).not.toHaveBeenCalled();
  });

  it("ログインしていれば、これまでどおり全件を返す", async () => {
    mocks.getCurrentProfile.mockResolvedValue({ id: "00000000-0000-4000-8000-000000000001" });
    const snapshot = await getSnapshotForExportAction();
    expect(snapshot.stores).toHaveLength(1);
  });
});
