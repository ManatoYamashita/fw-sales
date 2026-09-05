/**
 * `GET /api/cron/keepalive` の契約テスト (Issue #242)。
 *
 * 本 route は「無言で成功したように見えて何もしていない」状態が最も危険な種類の
 * エンドポイントである。Vercel Cron は失敗をリトライも通知もせず、Hobby プランの
 * Runtime Logs は 1 時間で消えるため、壊れても誰にも届かない。
 * よってここでは「成功したことにしない」性質を機械的に固定する。
 *
 * 特に最後のテストは **ビルド時に本番 DB へ書き込まないこと**の防波堤である。
 * Cache Components 有効時、Next.js はビルド中に GET ハンドラを実際に実行して
 * prerender 可能かを試す (node_modules/next/dist/export/routes/app-route.js)。
 * `request.headers` へのアクセスがその prerender を中断させるので、ヘッダ読み取りが
 * DB 書き込みより後ろに回ると `next build` が本番 `app_settings` を更新してしまう。
 *
 * 関連: Issue #242, app/api/export/__tests__/route.auth.test.ts (雛形)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KEEPALIVE_LAST_RUN_KEY } from "@/lib/domain/keepalive";

vi.mock("server-only", () => ({}));

const { mockSet } = vi.hoisted(() => ({ mockSet: vi.fn() }));

vi.mock("@/lib/repositories", () => ({
  repos: { appSettings: { set: mockSet } },
}));

const { GET } = await import("../route");

const SECRET = "test-cron-secret-value";
const ORIGINAL_SECRET = process.env.CRON_SECRET;

/**
 * `headers.get` と `appSettings.set` の呼び出し順序を記録する Request を作る。
 * 実際の `Request` を使うと headers への spy が張りにくいため、route が触る
 * 面 (`headers.get`) だけを持つ最小の代役を渡す。
 */
function makeRequest(authorization: string | null, trace: string[]): Request {
  return {
    headers: {
      get(name: string): string | null {
        trace.push(`headers.get:${name}`);
        return name.toLowerCase() === "authorization" ? authorization : null;
      },
    },
  } as unknown as Request;
}

function authorized(trace: string[] = []): Request {
  return makeRequest(`Bearer ${SECRET}`, trace);
}

describe("GET /api/cron/keepalive", () => {
  beforeEach(() => {
    mockSet.mockReset().mockResolvedValue(undefined);
    process.env.CRON_SECRET = SECRET;
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = ORIGINAL_SECRET;
  });

  describe("認可", () => {
    it("CRON_SECRET 未設定は 401 ではなく 500 を返す (設定漏れを『正しく拒否した』に見せない)", async () => {
      delete process.env.CRON_SECRET;
      const res = await GET(authorized());
      expect(res.status).toBe(500);
      expect(mockSet).not.toHaveBeenCalled();
    });

    it("Authorization ヘッダが無ければ 401 を返し DB に触れない", async () => {
      const res = await GET(makeRequest(null, []));
      expect(res.status).toBe(401);
      expect(mockSet).not.toHaveBeenCalled();
    });

    it("Bearer の値が違えば 401 を返し DB に触れない", async () => {
      const res = await GET(makeRequest("Bearer wrong-value", []));
      expect(res.status).toBe(401);
      expect(mockSet).not.toHaveBeenCalled();
    });

    it("スキームが違えば 401 を返す (生の秘密文字列だけでは通さない)", async () => {
      const res = await GET(makeRequest(SECRET, []));
      expect(res.status).toBe(401);
      expect(mockSet).not.toHaveBeenCalled();
    });

    it("拒否レスポンスは内部情報を含まない", async () => {
      const body = await (await GET(makeRequest(null, []))).json();
      expect(Object.keys(body)).toEqual(["error"]);
      expect(JSON.stringify(body)).not.toContain(SECRET);
    });
  });

  describe("keepalive 本体", () => {
    it("認可が通れば 200 を返し、最終実行時刻を ISO 文字列で 1 回だけ upsert する", async () => {
      const res = await GET(authorized());
      expect(res.status).toBe(200);
      expect(mockSet).toHaveBeenCalledTimes(1);

      const [key, value] = mockSet.mock.calls[0]!;
      expect(key).toBe(KEEPALIVE_LAST_RUN_KEY);
      expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
      expect(Number.isNaN(new Date(value as string).getTime())).toBe(false);
    });

    it("200 の本文は書き込んだ時刻を返す (画面表示と突き合わせられる)", async () => {
      const body = await (await GET(authorized())).json();
      expect(body.ok).toBe(true);
      expect(body.at).toBe(mockSet.mock.calls[0]![1]);
      expect(typeof body.ms).toBe("number");
    });

    it("DB 書き込みが失敗したら 500 にする (握り潰して 200 にしない)", async () => {
      mockSet.mockRejectedValue(new Error("connection terminated"));
      const res = await GET(authorized());
      expect(res.status).toBe(500);
      expect(await res.json()).not.toHaveProperty("ok");
    });
  });

  describe("キャッシュ", () => {
    // Vercel Cron はキャッシュ応答をログにすら残さない。キャッシュされること自体が
    // 無言故障になるため、成功・失敗を問わず no-store でなければならない。
    it.each([
      ["成功", async () => GET(authorized())],
      ["認可失敗", async () => GET(makeRequest(null, []))],
      [
        "設定漏れ",
        async () => {
          delete process.env.CRON_SECRET;
          return GET(authorized());
        },
      ],
    ])("%s のレスポンスは no-store", async (_label, run) => {
      expect((await run()).headers.get("Cache-Control")).toBe("no-store");
    });
  });

  describe("ビルド時に本番 DB を書かないための順序契約", () => {
    it("Authorization ヘッダの読み取りは DB 書き込みより先に起きる", async () => {
      const trace: string[] = [];
      mockSet.mockImplementation(async () => {
        trace.push("appSettings.set");
      });

      await GET(authorized(trace));

      const headerIndex = trace.findIndex((entry) =>
        entry.startsWith("headers.get:"),
      );
      const writeIndex = trace.indexOf("appSettings.set");

      expect(headerIndex).toBeGreaterThanOrEqual(0);
      expect(writeIndex).toBeGreaterThanOrEqual(0);
      expect(headerIndex).toBeLessThan(writeIndex);
    });
  });
});
