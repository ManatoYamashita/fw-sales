/**
 * getCurrentProfile のユニットテスト (マルチテナント化 #367)。
 *
 * - ロールはいまのテナントの所属 (memberships) から読み、profiles は読まない
 * - 所属の無いユーザーは null (認可ガードはこれを拒否として扱う) + 構造化ログ
 * - 未認証なら所属を引かずに null
 *
 * `@supabase/ssr` は proxy.test.ts と同じく vi.mock で fake 化し、実通信しない。
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

vi.mock("server-only", () => ({}));

const { mockGetUser, mockMembershipFind, mockProfileFindById } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockMembershipFind: vi.fn(),
  mockProfileFindById: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({ auth: { getUser: mockGetUser } })),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: () => undefined, get: () => undefined }),
}));

vi.mock("@/lib/repositories", () => ({
  repos: { forTenant: (tenantId: string) => {
    expect(tenantId).toBe(FIRSTWEB_TENANT_ID);
    return {
    membership: { find: mockMembershipFind },
    profile: { findById: mockProfileFindById },
  }; } },
}));

const { getCurrentProfile } = await import("../server");
const { FIRSTWEB_TENANT_ID } = await import("@/lib/db/schema");

const ORIG_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ORIG_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const MEMBER = {
  id: "user-1",
  email: "u@test.com",
  display_name: "テスト",
  avatar_url: null,
  role: "admin" as const,
  created_at: "2026-10-19",
  updated_at: "2026-10-19",
};

describe("getCurrentProfile", () => {
  let warnSpy: MockInstance;

  beforeAll(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  });

  afterAll(() => {
    if (ORIG_URL === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = ORIG_URL;
    if (ORIG_KEY === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ORIG_KEY;
  });

  beforeEach(() => {
    mockGetUser.mockReset();
    mockMembershipFind.mockReset();
    mockProfileFindById.mockReset();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    // どの経路でも profiles からロールを読まない
    expect(mockProfileFindById).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("所属があれば、いまのテナントでのロール付きで返す", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: { id: "user-1", email: "u@test.com" } }, error: null });
    mockMembershipFind.mockResolvedValueOnce(MEMBER);

    await expect(getCurrentProfile()).resolves.toEqual(MEMBER);
    expect(mockMembershipFind).toHaveBeenCalledWith("user-1");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("ログイン済みでも所属が無ければ null を返し、理由を構造化ログに残す", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: { id: "user-2", email: "x@test.com" } }, error: null });
    mockMembershipFind.mockResolvedValueOnce(null);

    await expect(getCurrentProfile()).resolves.toBeNull();
    expect(warnSpy).toHaveBeenCalledWith("[authz] no membership", {
      userId: "user-2",
      tenantId: FIRSTWEB_TENANT_ID,
    });
  });

  it("未認証なら所属を引かずに null", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null });

    await expect(getCurrentProfile()).resolves.toBeNull();
    expect(mockMembershipFind).not.toHaveBeenCalled();
  });
});
