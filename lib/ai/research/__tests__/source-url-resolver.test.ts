/**
 * Stage 1.5 safe URL resolver の単体検証(AI 店舗調査再設計 Plan v3.2 §11, PR2)。
 *
 * SSRF対策の中核である `isDisallowedAddress` / `isAllowedStartHost` を直接検証し、
 * 加えて `resolveGroundingRedirectUrl` をネットワークモックで検証する。
 * 実ネットワークリクエストは一切行わない。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

const requestMock = vi.fn();
const lookupMock = vi.fn();

vi.mock("node:https", () => ({
  request: (...args: unknown[]) => requestMock(...args),
}));

vi.mock("node:dns", () => ({
  promises: {
    lookup: (...args: unknown[]) => lookupMock(...args),
  },
}));

import {
  resolveGroundingRedirectUrl,
  isAllowedStartHost,
} from "../source-url-resolver";
// IP レンジ判定は lib/security/url-safety.ts へ一本化された(PR #199 の二重実装解消)。
// resolver 経由で同じ判定が効いていることを本ファイルでも引き続き固定する。
import { isDisallowedAddress } from "@/lib/security/url-safety";

describe("isAllowedStartHost", () => {
  it("vertexaisearch.cloud.google.com を許可する", () => {
    expect(isAllowedStartHost("vertexaisearch.cloud.google.com")).toBe(true);
  });

  it("大文字小文字を区別しない", () => {
    expect(isAllowedStartHost("VertexAISearch.Cloud.Google.Com")).toBe(true);
  });

  it("許可外のホストを拒否する", () => {
    expect(isAllowedStartHost("evil.example.com")).toBe(false);
    expect(isAllowedStartHost("google.com")).toBe(false);
    expect(isAllowedStartHost("vertexaisearch.cloud.google.com.evil.com")).toBe(false);
  });
});

describe("isDisallowedAddress (SSRF対策の中核)", () => {
  it("loopback (127.0.0.1) を拒否する", () => {
    expect(isDisallowedAddress("127.0.0.1")).toBe(true);
  });

  it("private IPv4 (10.x / 172.16-31.x / 192.168.x) を拒否する", () => {
    expect(isDisallowedAddress("10.0.0.1")).toBe(true);
    expect(isDisallowedAddress("172.16.0.1")).toBe(true);
    expect(isDisallowedAddress("172.31.255.255")).toBe(true);
    expect(isDisallowedAddress("192.168.1.1")).toBe(true);
  });

  it("172.15.x / 172.32.x (private範囲外) は拒否しない", () => {
    expect(isDisallowedAddress("172.15.0.1")).toBe(false);
    expect(isDisallowedAddress("172.32.0.1")).toBe(false);
  });

  it("cloudメタデータエンドポイント (169.254.169.254) を拒否する", () => {
    expect(isDisallowedAddress("169.254.169.254")).toBe(true);
  });

  it("link-local (169.254.0.0/16) を拒否する", () => {
    expect(isDisallowedAddress("169.254.1.1")).toBe(true);
  });

  it("CGNAT (100.64.0.0/10) を拒否する", () => {
    expect(isDisallowedAddress("100.64.0.1")).toBe(true);
    expect(isDisallowedAddress("100.100.0.1")).toBe(true);
  });

  it("0.0.0.0/8 を拒否する", () => {
    expect(isDisallowedAddress("0.0.0.0")).toBe(true);
  });

  it("multicast/reserved (224.0.0.0以上) を拒否する", () => {
    expect(isDisallowedAddress("224.0.0.1")).toBe(true);
    expect(isDisallowedAddress("255.255.255.255")).toBe(true);
  });

  it("public IPv4 は許可する", () => {
    expect(isDisallowedAddress("8.8.8.8")).toBe(false);
    expect(isDisallowedAddress("142.250.196.100")).toBe(false); // google.com 相当
  });

  it("IPv6 loopback (::1) を拒否する", () => {
    expect(isDisallowedAddress("::1")).toBe(true);
  });

  it("IPv6 unique local (fc00::/7, fd00::/8) を拒否する", () => {
    expect(isDisallowedAddress("fc00::1")).toBe(true);
    expect(isDisallowedAddress("fd00::1")).toBe(true);
  });

  it("IPv6 link-local (fe80::/10) を拒否する", () => {
    expect(isDisallowedAddress("fe80::1")).toBe(true);
  });

  it("IPv4-mapped IPv6 (::ffff:127.0.0.1) を内包IPv4として拒否する", () => {
    expect(isDisallowedAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isDisallowedAddress("::ffff:10.0.0.1")).toBe(true);
  });

  it("public IPv6 は許可する", () => {
    expect(isDisallowedAddress("2001:4860:4860::8888")).toBe(false); // Google Public DNS
  });

  it("解釈できないアドレスは安全側で拒否する", () => {
    expect(isDisallowedAddress("not-an-ip-address")).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/*  resolveGroundingRedirectUrl (ネットワークモック)                     */
/* ------------------------------------------------------------------ */

function mockLookupSuccess(address: string, family: 4 | 6 = 4) {
  lookupMock.mockResolvedValue([{ address, family }]);
}

/** https.request の最小モック。ヘッダ受信コールバックを1回だけ呼び、bodyは扱わない。 */
function mockHttpsResponse(statusCode: number, headers: Record<string, string> = {}) {
  requestMock.mockImplementation((_options: unknown, callback: (res: unknown) => void) => {
    const req = new EventEmitter() as EventEmitter & { end: () => void; destroy: () => void };
    req.end = () => {
      const res = new EventEmitter() as EventEmitter & {
        statusCode: number;
        headers: Record<string, string>;
        destroy: () => void;
      };
      res.statusCode = statusCode;
      res.headers = headers;
      res.destroy = () => {};
      callback(res);
    };
    req.destroy = () => {};
    return req;
  });
}

function mockHttpsError(message: string) {
  requestMock.mockImplementation(() => {
    const req = new EventEmitter() as EventEmitter & { end: () => void; destroy: () => void };
    req.end = () => {
      // 非同期でerrorを発火させる(実際のhttpsモジュールの挙動に近似)
      setImmediate(() => req.emit("error", new Error(message)));
    };
    req.destroy = () => {};
    return req;
  });
}

describe("resolveGroundingRedirectUrl", () => {
  beforeEach(() => {
    requestMock.mockReset();
    lookupMock.mockReset();
  });

  it("許可外の起点ホストは即座にfailedを返す(DNS/HTTPリクエストを一切行わない)", async () => {
    const result = await resolveGroundingRedirectUrl("https://evil.example.com/x");
    expect(result.status).toBe("failed");
    expect(lookupMock).not.toHaveBeenCalled();
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("http(非https)の起点URLはfailedを返す", async () => {
    const result = await resolveGroundingRedirectUrl(
      "http://vertexaisearch.cloud.google.com/grounding-api-redirect/x",
    );
    expect(result.status).toBe("failed");
  });

  it("credentials付きURLはfailedを返す", async () => {
    const result = await resolveGroundingRedirectUrl(
      "https://user:pass@vertexaisearch.cloud.google.com/grounding-api-redirect/x",
    );
    expect(result.status).toBe("failed");
  });

  it("不正なURL文字列はfailedを返す", async () => {
    const result = await resolveGroundingRedirectUrl("not a url");
    expect(result.status).toBe("failed");
  });

  it("DNS解決結果がprivate IPならfailedを返す(SSRF対策)", async () => {
    mockLookupSuccess("127.0.0.1");
    const result = await resolveGroundingRedirectUrl(
      "https://vertexaisearch.cloud.google.com/grounding-api-redirect/x",
    );
    expect(result.status).toBe("failed");
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("正常なpublic IPかつ200応答なら解決成功しURLを返す", async () => {
    mockLookupSuccess("142.250.196.100");
    mockHttpsResponse(200);
    const result = await resolveGroundingRedirectUrl(
      "https://vertexaisearch.cloud.google.com/grounding-api-redirect/x",
    );
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.url).toContain("vertexaisearch.cloud.google.com");
    }
  });

  it("redirectを1回追跡して最終URLを解決する", async () => {
    let callCount = 0;
    mockLookupSuccess("142.250.196.100");
    requestMock.mockImplementation((_options: unknown, callback: (res: unknown) => void) => {
      callCount++;
      const req = new EventEmitter() as EventEmitter & { end: () => void; destroy: () => void };
      req.end = () => {
        const res = new EventEmitter() as EventEmitter & {
          statusCode: number;
          headers: Record<string, string>;
          destroy: () => void;
        };
        res.destroy = () => {};
        if (callCount === 1) {
          res.statusCode = 302;
          res.headers = { location: "https://r.gnavi.co.jp/final-page/" };
        } else {
          res.statusCode = 200;
          res.headers = {};
        }
        callback(res);
      };
      req.destroy = () => {};
      return req;
    });

    const result = await resolveGroundingRedirectUrl(
      "https://vertexaisearch.cloud.google.com/grounding-api-redirect/x",
    );
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.url).toBe("https://r.gnavi.co.jp/final-page/");
    }
    expect(callCount).toBe(2);
  });

  it("redirect先がhttpへダウングレードする場合はfailedを返す", async () => {
    mockLookupSuccess("142.250.196.100");
    mockHttpsResponse(302, { location: "http://insecure.example.com/" });
    const result = await resolveGroundingRedirectUrl(
      "https://vertexaisearch.cloud.google.com/grounding-api-redirect/x",
    );
    expect(result.status).toBe("failed");
  });

  it("redirect先がprivate IPを指す場合はfailedを返す(redirect先SSRF対策)", async () => {
    let callCount = 0;
    lookupMock.mockImplementation(async () => {
      callCount++;
      // 1回目(起点host)はpublic、2回目(redirect先)はprivateを返す
      return callCount === 1
        ? [{ address: "142.250.196.100", family: 4 }]
        : [{ address: "169.254.169.254", family: 4 }];
    });
    mockHttpsResponse(302, { location: "https://internal.example.com/" });

    const result = await resolveGroundingRedirectUrl(
      "https://vertexaisearch.cloud.google.com/grounding-api-redirect/x",
    );
    expect(result.status).toBe("failed");
  });

  it("redirect回数が上限を超えるとfailedを返す", async () => {
    mockLookupSuccess("142.250.196.100");
    let hop = 0;
    requestMock.mockImplementation((_options: unknown, callback: (res: unknown) => void) => {
      hop++;
      const req = new EventEmitter() as EventEmitter & { end: () => void; destroy: () => void };
      req.end = () => {
        const res = new EventEmitter() as EventEmitter & {
          statusCode: number;
          headers: Record<string, string>;
          destroy: () => void;
        };
        res.destroy = () => {};
        res.statusCode = 302;
        res.headers = { location: `https://vertexaisearch.cloud.google.com/hop-${hop}` };
        callback(res);
      };
      req.destroy = () => {};
      return req;
    });

    const result = await resolveGroundingRedirectUrl(
      "https://vertexaisearch.cloud.google.com/grounding-api-redirect/x",
    );
    expect(result.status).toBe("failed");
  });

  it("HTTPリクエスト自体がエラーになった場合はfailedを返す", async () => {
    mockLookupSuccess("142.250.196.100");
    mockHttpsError("ECONNRESET");
    const result = await resolveGroundingRedirectUrl(
      "https://vertexaisearch.cloud.google.com/grounding-api-redirect/x",
    );
    expect(result.status).toBe("failed");
  });
});
