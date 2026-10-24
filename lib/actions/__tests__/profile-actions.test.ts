/**
 * updateProfileRoleAction のユニットテスト (#155 ユーザー管理)。
 *
 * - admin ガード (非 admin 拒否)
 * - role 検証 (member/admin 以外を拒否)
 * - 最後の管理者保護 (テナントの admin が 1 人のとき降格拒否)
 * - 成功時の updateRole 呼び出し + profiles キャッシュ invalidate + [audit] ログ
 * - ロールはいまのテナントの所属 (memberships) に対して読み書きし、profiles には触れない (#367)
 *
 * mock 様式は store-actions.bulk-delete.test.ts / authz.test.ts に準拠。
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";

vi.mock("server-only", () => ({}));

const {
  mockGetCurrentProfile,
  mockMembershipFind,
  mockCountAdmins,
  mockUpdateRole,
  mockProfileFindById,
  mockUpdateTag,
} = vi.hoisted(() => ({
  mockGetCurrentProfile: vi.fn(),
  mockMembershipFind: vi.fn(),
  mockCountAdmins: vi.fn(),
  mockUpdateRole: vi.fn(),
  mockProfileFindById: vi.fn(),
  mockUpdateTag: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  getCurrentProfile: mockGetCurrentProfile,
}));

vi.mock("@/lib/repositories", () => ({
  repos: ((tenantRepos) => ({ ...tenantRepos, forTenant: () => tenantRepos }))({
    membership: {
      find: mockMembershipFind,
      countAdmins: mockCountAdmins,
      updateRole: mockUpdateRole,
    },
    // ロールの読み書きに profiles を使っていないことを確かめるためだけに置く
    profile: {
      findById: mockProfileFindById,
    },
  }),
}));

vi.mock("next/cache", () => ({
  updateTag: mockUpdateTag,
}));

const { updateProfileRoleAction } = await import("../profile-actions");
const { FIRSTWEB_TENANT_ID } = await import("@/lib/db/schema");

function makeMember(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-1",
    email: "u@test.com",
    display_name: "テスト",
    avatar_url: null,
    role: "member" as const,
    created_at: "2026-07-06",
    updated_at: "2026-07-06",
    ...overrides,
  };
}

const ADMIN = makeMember({ id: "admin-1", email: "admin@test.com", role: "admin" });

describe("updateProfileRoleAction", () => {
  let logSpy: MockInstance;
  let warnSpy: MockInstance;

  beforeEach(() => {
    mockGetCurrentProfile.mockReset();
    mockMembershipFind.mockReset();
    mockCountAdmins.mockReset();
    mockUpdateRole.mockReset();
    mockProfileFindById.mockReset();
    mockUpdateTag.mockReset();
    mockGetCurrentProfile.mockResolvedValue(ADMIN);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    // どの経路でも profiles からロールを読まない
    expect(mockProfileFindById).not.toHaveBeenCalled();
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("非 admin は拒否され、updateRole を呼ばない", async () => {
    mockGetCurrentProfile.mockResolvedValueOnce(makeMember({ role: "member" }));

    const result = await updateProfileRoleAction("user-2", "admin");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/管理者/);
    expect(mockUpdateRole).not.toHaveBeenCalled();
  });

  it("admin が member を admin に昇格 → success + テナントの所属を更新 + キャッシュ invalidate + [audit]", async () => {
    const updated = makeMember({ id: "user-2", email: "b@test.com", role: "admin" });
    mockUpdateRole.mockResolvedValueOnce(updated);

    const result = await updateProfileRoleAction("user-2", "admin");

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual(updated);
    expect(mockUpdateRole).toHaveBeenCalledWith("user-2", "admin");
    // profiles 集合 + 個別タグの両方を invalidate する
    expect(mockUpdateTag).toHaveBeenCalledWith("tenant:cfe871a5-8fc7-42da-9677-3a050665cafb:profiles");
    expect(mockUpdateTag).toHaveBeenCalledWith("tenant:cfe871a5-8fc7-42da-9677-3a050665cafb:profile:user-2");
    expect(logSpy).toHaveBeenCalledWith(
      "[audit] profiles.updateRole",
      expect.objectContaining({
        by: "admin@test.com",
        tenantId: FIRSTWEB_TENANT_ID,
        targetId: "user-2",
        to: "admin",
      }),
    );
  });

  it("最後の admin を降格しようとすると拒否され、updateRole を呼ばない", async () => {
    mockMembershipFind.mockResolvedValueOnce(makeMember({ id: "admin-1", role: "admin" }));
    mockCountAdmins.mockResolvedValueOnce(1);

    const result = await updateProfileRoleAction("admin-1", "member");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/最後の管理者/);
    expect(mockMembershipFind).toHaveBeenCalledWith("admin-1");
    expect(mockCountAdmins).toHaveBeenCalledWith();
    expect(mockUpdateRole).not.toHaveBeenCalled();
  });

  it("テナントの admin が 2 人いれば 1 人を降格できる", async () => {
    mockMembershipFind.mockResolvedValueOnce(makeMember({ id: "admin-2", role: "admin" }));
    mockCountAdmins.mockResolvedValueOnce(2);
    const updated = makeMember({ id: "admin-2", role: "member" });
    mockUpdateRole.mockResolvedValueOnce(updated);

    const result = await updateProfileRoleAction("admin-2", "member");

    expect(result.ok).toBe(true);
    expect(mockUpdateRole).toHaveBeenCalledWith("admin-2", "member");
  });

  it("member への降格でも対象が member なら最後の admin 判定をせず更新する", async () => {
    // 対象が既に member (admin ではない) の場合、admin の数は数えない
    mockMembershipFind.mockResolvedValueOnce(makeMember({ id: "user-3", role: "member" }));
    const updated = makeMember({ id: "user-3", role: "member" });
    mockUpdateRole.mockResolvedValueOnce(updated);

    const result = await updateProfileRoleAction("user-3", "member");

    expect(result.ok).toBe(true);
    expect(mockCountAdmins).not.toHaveBeenCalled();
    expect(mockUpdateRole).toHaveBeenCalledWith("user-3", "member");
  });

  it("member/admin 以外の role は拒否され、updateRole を呼ばない", async () => {
    const result = await updateProfileRoleAction("user-2", "placeholder");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/指定できない/);
    expect(mockUpdateRole).not.toHaveBeenCalled();
  });

  it("所属の無いユーザーの降格は、更新せずに failure", async () => {
    mockMembershipFind.mockResolvedValueOnce(null);

    const result = await updateProfileRoleAction("ghost", "member");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/見つかりません/);
    expect(mockUpdateRole).not.toHaveBeenCalled();
  });

  it("所属の無いユーザーの昇格は failure", async () => {
    mockUpdateRole.mockResolvedValueOnce(null);

    const result = await updateProfileRoleAction("ghost", "admin");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/見つかりません/);
  });
});
