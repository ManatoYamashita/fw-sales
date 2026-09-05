/**
 * `GET /api/export` の認証ゲート回帰テスト。
 *
 * 本 route は DB スナップショット全件 (店舗の連絡先・商談の見積/受注額・失注理由を
 * 含む) を返すが、`proxy.ts` の `config.matcher` が `/api/*` を除外しているため
 * proxy には守られない。認可はハンドラ自身が持つ、という契約を固定する。
 *
 * 経緯: 認証導入 (#16) 以前の設計 (`.kiro/specs/deals-stores-db-migration/design.md`
 * の API 定義表が `Auth: (none)`) をそのまま引き継いでおり、#155 / #156 の認可
 * スイープは Server Action のみを対象としていたため Route Handler が射程外だった。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { mockRequireSignedIn, mockDealList, mockStoreList, mockHandoffList } =
  vi.hoisted(() => ({
    mockRequireSignedIn: vi.fn(),
    mockDealList: vi.fn(),
    mockStoreList: vi.fn(),
    mockHandoffList: vi.fn(),
  }));

vi.mock("@/lib/actions/_authz", () => ({ requireSignedIn: mockRequireSignedIn }));
vi.mock("@/lib/repositories", () => ({
  repos: {
    deal: { list: mockDealList },
    store: { list: mockStoreList },
    handoff: { list: mockHandoffList },
  },
}));

const { GET } = await import("../route");

describe("GET /api/export の認証ゲート", () => {
  beforeEach(() => {
    mockRequireSignedIn.mockReset();
    mockDealList.mockReset().mockResolvedValue([]);
    mockStoreList.mockReset().mockResolvedValue([]);
    mockHandoffList.mockReset().mockResolvedValue([]);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("未認証は 401 を返す", async () => {
    mockRequireSignedIn.mockResolvedValue({ ok: false, error: "ログインが必要です" });
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("未認証のときは DB へ一切問い合わせない (スナップショットを組み立てない)", async () => {
    mockRequireSignedIn.mockResolvedValue({ ok: false, error: "ログインが必要です" });
    await GET();
    expect(mockDealList).not.toHaveBeenCalled();
    expect(mockStoreList).not.toHaveBeenCalled();
    expect(mockHandoffList).not.toHaveBeenCalled();
  });

  it("未認証のレスポンス本文に業務データが含まれない", async () => {
    mockRequireSignedIn.mockResolvedValue({ ok: false, error: "ログインが必要です" });
    const body = await (await GET()).json();
    expect(Object.keys(body)).toEqual(["error"]);
    expect(body).not.toHaveProperty("stores");
    expect(body).not.toHaveProperty("deals");
    expect(body).not.toHaveProperty("handoffs");
  });

  it("ログイン済み (ロール不問) は 200 で 3 entity を返す", async () => {
    mockRequireSignedIn.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(Object.keys(await res.json())).toEqual(["stores", "deals", "handoffs"]);
  });

  it("ログイン済みのレスポンスは添付ファイルとして返る", async () => {
    mockRequireSignedIn.mockResolvedValue(null);
    const res = await GET();
    expect(res.headers.get("Content-Disposition")).toMatch(/^attachment; filename=/);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
