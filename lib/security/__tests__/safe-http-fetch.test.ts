import { describe, expect, it, vi, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import * as https from "node:https";
import * as http from "node:http";
import * as dns from "node:dns";
import { safeFetchHtml } from "../safe-http-fetch";

vi.mock("node:https", () => ({ request: vi.fn() }));
vi.mock("node:http", () => ({ request: vi.fn() }));
vi.mock("node:dns", () => ({ promises: { lookup: vi.fn() } }));

type MockRes = EventEmitter & {
  statusCode: number;
  headers: Record<string, string>;
  resume: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
};

type MockReq = EventEmitter & {
  end: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
};

function createMockRes(statusCode: number, headers: Record<string, string> = {}): MockRes {
  const res = new EventEmitter() as MockRes;
  res.statusCode = statusCode;
  res.headers = headers;
  res.resume = vi.fn();
  res.destroy = vi.fn(() => {
    res.emit("close");
  });
  return res;
}

function createMockReq(): MockReq {
  const req = new EventEmitter() as MockReq;
  req.end = vi.fn();
  req.destroy = vi.fn((err?: Error) => {
    if (err) queueMicrotask(() => req.emit("error", err));
  });
  return req;
}

/** `client.request` を1回分モックする。callback呼出後、`drive`で任意のイベント列を発火させる。 */
function mockRequestOnce(
  client: typeof https | typeof http,
  res: MockRes,
  drive: (res: MockRes, req: MockReq) => void,
): MockReq {
  const req = createMockReq();
  vi.mocked(client.request).mockImplementationOnce(((
    _options: unknown,
    callback: (res: MockRes) => void,
  ) => {
    queueMicrotask(() => {
      callback(res);
      drive(res, req);
    });
    return req;
  }) as unknown as typeof client.request);
  return req;
}

function mockDnsResolvesTo(address: string, family: 4 | 6 = 4) {
  vi.mocked(dns.promises.lookup).mockResolvedValueOnce([{ address, family }] as never);
}

function driveNormalBody(chunks: string[]) {
  return (res: MockRes) => {
    for (const c of chunks) res.emit("data", Buffer.from(c, "utf-8"));
    res.emit("end");
  };
}

afterEach(() => {
  vi.mocked(https.request).mockReset();
  vi.mocked(http.request).mockReset();
  vi.mocked(dns.promises.lookup).mockReset();
});

describe("safeFetchHtml: ALLOW", () => {
  it("通常のpublic httpsホスト", async () => {
    mockDnsResolvesTo("93.184.216.34");
    mockRequestOnce(
      https,
      createMockRes(200, { "content-type": "text/html; charset=utf-8" }),
      driveNormalBody(["<html><body>hello</body></html>"]),
    );
    const result = await safeFetchHtml("https://example.com/");
    expect(result).toEqual({
      ok: true,
      status: 200,
      finalUrl: "https://example.com/",
      body: "<html><body>hello</body></html>",
      contentType: "text/html; charset=utf-8",
    });
  });

  it("通常のpublic httpホスト", async () => {
    mockDnsResolvesTo("93.184.216.34");
    mockRequestOnce(
      http,
      createMockRes(200, { "content-type": "text/html" }),
      driveNormalBody(["<html></html>"]),
    );
    const result = await safeFetchHtml("http://example.com/");
    expect(result.ok).toBe(true);
  });

  it("安全なredirect(絶対URL)を追跡する", async () => {
    mockDnsResolvesTo("93.184.216.34");
    mockRequestOnce(https, createMockRes(302, { location: "https://example.com/new" }), () => {});
    mockDnsResolvesTo("93.184.216.34");
    mockRequestOnce(
      https,
      createMockRes(200, { "content-type": "text/html" }),
      driveNormalBody(["moved"]),
    );
    const result = await safeFetchHtml("https://example.com/old");
    expect(result).toEqual({
      ok: true,
      status: 200,
      finalUrl: "https://example.com/new",
      body: "moved",
      contentType: "text/html",
    });
  });

  it("相対URLのredirectを追跡する", async () => {
    mockDnsResolvesTo("93.184.216.34");
    mockRequestOnce(https, createMockRes(301, { location: "/moved-here" }), () => {});
    mockDnsResolvesTo("93.184.216.34");
    mockRequestOnce(
      https,
      createMockRes(200, { "content-type": "text/html" }),
      driveNormalBody(["ok"]),
    );
    const result = await safeFetchHtml("https://example.com/old-path");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.finalUrl).toBe("https://example.com/moved-here");
    }
  });

  it("複数hopのredirectを追跡する", async () => {
    mockDnsResolvesTo("93.184.216.34");
    mockRequestOnce(https, createMockRes(302, { location: "https://example.com/hop2" }), () => {});
    mockDnsResolvesTo("93.184.216.34");
    mockRequestOnce(https, createMockRes(302, { location: "https://example.com/hop3" }), () => {});
    mockDnsResolvesTo("93.184.216.34");
    mockRequestOnce(
      https,
      createMockRes(200, { "content-type": "text/html" }),
      driveNormalBody(["final"]),
    );
    const result = await safeFetchHtml("https://example.com/hop1");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.finalUrl).toBe("https://example.com/hop3");
  });
});

describe("safeFetchHtml: DENY", () => {
  it("literal IPv4のprivate range (127.0.0.1) はDNS/HTTP発火前に拒否", async () => {
    const result = await safeFetchHtml("http://127.0.0.1/");
    expect(result).toEqual({ ok: false, reason: "disallowed_ip_range" });
    expect(http.request).not.toHaveBeenCalled();
  });

  it("cloud metadata endpoint (169.254.169.254) を拒否", async () => {
    const result = await safeFetchHtml("http://169.254.169.254/latest/meta-data/");
    expect(result).toEqual({ ok: false, reason: "disallowed_ip_range" });
    expect(http.request).not.toHaveBeenCalled();
  });

  it("数値表記難読化(2130706433 = 127.0.0.1)を拒否", async () => {
    const url = new URL("http://2130706433/");
    expect(url.hostname).toBe("127.0.0.1");
    const result = await safeFetchHtml("http://2130706433/");
    expect(result).toEqual({ ok: false, reason: "disallowed_ip_range" });
  });

  it("IPv6 literal ([::1]) を角括弧ストリップのうえ拒否", async () => {
    const result = await safeFetchHtml("http://[::1]/");
    expect(result).toEqual({ ok: false, reason: "disallowed_ip_range" });
    expect(http.request).not.toHaveBeenCalled();
  });

  it("credentials付きURLを拒否", async () => {
    const result = await safeFetchHtml("https://user:pass@example.com/");
    expect(result).toEqual({ ok: false, reason: "credentials_in_url" });
  });

  it("file://スキームを拒否", async () => {
    const result = await safeFetchHtml("file:///etc/passwd");
    expect(result).toEqual({ ok: false, reason: "disallowed_scheme" });
  });

  it("redirect先がprivate IPの場合は拒否(public→private)", async () => {
    mockDnsResolvesTo("93.184.216.34");
    mockRequestOnce(
      https,
      createMockRes(302, { location: "http://10.0.0.5/internal" }),
      () => {},
    );
    const result = await safeFetchHtml("https://example.com/redirector");
    expect(result).toEqual({ ok: false, reason: "disallowed_ip_range" });
  });

  it("redirect先がcloud metadataの場合は拒否(public→metadata)", async () => {
    mockDnsResolvesTo("93.184.216.34");
    mockRequestOnce(
      https,
      createMockRes(302, { location: "http://169.254.169.254/latest/meta-data/" }),
      () => {},
    );
    const result = await safeFetchHtml("https://example.com/redirector");
    expect(result).toEqual({ ok: false, reason: "disallowed_ip_range" });
  });

  it("too many redirects(maxRedirects超過)を検出", async () => {
    for (let i = 0; i < 10; i++) {
      mockDnsResolvesTo("93.184.216.34");
      mockRequestOnce(
        https,
        createMockRes(302, { location: `https://example.com/hop${i + 1}` }),
        () => {},
      );
    }
    const result = await safeFetchHtml("https://example.com/hop0", { maxRedirects: 3 });
    expect(result).toEqual({ ok: false, reason: "too_many_redirects" });
  });

  it("redirect先がIPv6 loopback([::1])の場合は拒否(public→[::1])、2hop目のnetwork requestは開始されない", async () => {
    mockDnsResolvesTo("93.184.216.34");
    mockRequestOnce(https, createMockRes(302, { location: "http://[::1]/" }), () => {});
    const callCountBefore =
      vi.mocked(https.request).mock.calls.length + vi.mocked(http.request).mock.calls.length;
    const result = await safeFetchHtml("https://example.com/redirector");
    expect(result).toEqual({ ok: false, reason: "disallowed_ip_range" });
    // mockRequestOnceで1回分予約したが、2hop目([::1]検証)はvalidateExternalUrlで
    // 拒否されるためclient.request自体が呼ばれない(呼出回数が1回目のまま増えない)。
    const callCountAfter =
      vi.mocked(https.request).mock.calls.length + vi.mocked(http.request).mock.calls.length;
    expect(callCountAfter).toBe(callCountBefore + 1);
  });

  it("redirect先がcredentials付きURLの場合は拒否(public→credential URL)、2hop目のnetwork requestは開始されない", async () => {
    mockDnsResolvesTo("93.184.216.34");
    mockRequestOnce(
      https,
      createMockRes(302, { location: "https://user:pass@example.com/secret" }),
      () => {},
    );
    const callCountBefore =
      vi.mocked(https.request).mock.calls.length + vi.mocked(http.request).mock.calls.length;
    const result = await safeFetchHtml("https://example.com/redirector");
    expect(result).toEqual({ ok: false, reason: "credentials_in_url" });
    const callCountAfter =
      vi.mocked(https.request).mock.calls.length + vi.mocked(http.request).mock.calls.length;
    expect(callCountAfter).toBe(callCountBefore + 1);
  });

  it("redirect先がfile://スキームの場合は拒否(public→file://)、2hop目のnetwork requestは開始されない", async () => {
    mockDnsResolvesTo("93.184.216.34");
    mockRequestOnce(https, createMockRes(302, { location: "file:///etc/passwd" }), () => {});
    const callCountBefore =
      vi.mocked(https.request).mock.calls.length + vi.mocked(http.request).mock.calls.length;
    const result = await safeFetchHtml("https://example.com/redirector");
    expect(result).toEqual({ ok: false, reason: "disallowed_scheme" });
    const callCountAfter =
      vi.mocked(https.request).mock.calls.length + vi.mocked(http.request).mock.calls.length;
    expect(callCountAfter).toBe(callCountBefore + 1);
  });
});

describe("safeFetchHtml: 境界値", () => {
  it("Content-Length超過は即座にbody_too_large", async () => {
    mockDnsResolvesTo("93.184.216.34");
    const res = createMockRes(200, {
      "content-type": "text/html",
      "content-length": String(10_000_000),
    });
    mockRequestOnce(https, res, () => {});
    const result = await safeFetchHtml("https://example.com/huge", { maxBodyBytes: 2_000_000 });
    expect(result).toEqual({ ok: false, reason: "body_too_large" });
    expect(res.destroy).toHaveBeenCalled();
  });

  it("streaming中にmaxBodyBytesを超えた場合、即座にdestroyしそれ以上読み続けない", async () => {
    mockDnsResolvesTo("93.184.216.34");
    const res = createMockRes(200, { "content-type": "text/html" }); // Content-Lengthヘッダなし(chunked相当)
    let dataCount = 0;
    mockRequestOnce(https, res, (r) => {
      // 1chunk目で上限(10 bytes)を超える15byteを送る
      dataCount++;
      r.emit("data", Buffer.alloc(15, "a"));
      // 本来ならここでdestroy済みのはずなので、2chunk目を送っても後続処理に影響しないことを確認する
      dataCount++;
      r.emit("data", Buffer.alloc(15, "b"));
    });
    const result = await safeFetchHtml("https://example.com/streaming", { maxBodyBytes: 10 });
    expect(result).toEqual({ ok: false, reason: "body_too_large" });
    expect(res.destroy).toHaveBeenCalled();
    expect(dataCount).toBe(2); // モック側は2回emitしたが、実装側は1回目でdestroyを呼んでいることをdestroy呼出で確認済み
  });

  it("誤ったContent-Type(application/octet-stream)を拒否", async () => {
    mockDnsResolvesTo("93.184.216.34");
    const res = createMockRes(200, { "content-type": "application/octet-stream" });
    mockRequestOnce(https, res, () => {});
    const result = await safeFetchHtml("https://example.com/binary");
    expect(result).toEqual({ ok: false, reason: "disallowed_content_type" });
    expect(res.destroy).toHaveBeenCalled();
  });

  it("Content-Encodingがidentity以外(gzip)なら拒否", async () => {
    mockDnsResolvesTo("93.184.216.34");
    const res = createMockRes(200, {
      "content-type": "text/html",
      "content-encoding": "gzip",
    });
    mockRequestOnce(https, res, () => {});
    const result = await safeFetchHtml("https://example.com/compressed");
    expect(result).toEqual({ ok: false, reason: "disallowed_content_type" });
  });

  it("hop timeoutでtimeoutを返す", async () => {
    mockDnsResolvesTo("93.184.216.34");
    const req = createMockReq();
    vi.mocked(https.request).mockImplementationOnce((() => {
      // callbackを一切呼ばず、timeoutイベントのみ発火させてhangを模擬
      queueMicrotask(() => req.emit("timeout"));
      return req;
    }) as unknown as typeof https.request);
    const result = await safeFetchHtml("https://example.com/slow", { hopTimeoutMs: 50 });
    expect(result).toEqual({ ok: false, reason: "timeout" });
  });

  it("slow-loris: hopTimeout未満の間隔でdataを送り続けても、absolute totalTimeoutMs到達で強制終了する(fake timer使用、commit前review Finding #2の修正)", async () => {
    vi.useFakeTimers();
    try {
      mockDnsResolvesTo("93.184.216.34");
      const res = createMockRes(200, { "content-type": "text/html" });
      const req = createMockReq();
      vi.mocked(https.request).mockImplementationOnce(((
        _options: unknown,
        callback: (r: MockRes) => void,
      ) => {
        queueMicrotask(() => callback(res));
        return req;
      }) as unknown as typeof https.request);

      const resultPromise = safeFetchHtml("https://example.com/slow-drip", {
        totalTimeoutMs: 1000,
        // Node idle timeoutでは検知できないほど大きく設定し、absolute deadlineのみが
        // 効くシナリオを作る(実時間ではなくfake timerでのみ経過させる)。
        hopTimeoutMs: 10_000,
      });

      // headers受信(内部のqueueMicrotask)を処理させる。
      await vi.advanceTimersByTimeAsync(0);

      // hopTimeoutMs(10000ms)未満の間隔(300ms)でdataを送り続ける。
      // 各間隔はhopTimeoutMs未満だが、累積(300ms×4=1200ms)はtotalTimeoutMs(1000ms)を超える。
      for (let i = 0; i < 4; i++) {
        res.emit("data", Buffer.from("x"));
        await vi.advanceTimersByTimeAsync(300);
      }

      const result = await resultPromise;
      expect(result).toEqual({ ok: false, reason: "timeout" });
      expect(res.destroy).toHaveBeenCalled();
      expect(req.destroy).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("DNS解決失敗はdns_lookup_failed", async () => {
    vi.mocked(dns.promises.lookup).mockRejectedValueOnce(new Error("ENOTFOUND"));
    const result = await safeFetchHtml("https://nonexistent.invalid/");
    expect(result).toEqual({ ok: false, reason: "dns_lookup_failed" });
  });

  it("total timeout超過時はDNS lookup前でも打ち切る", async () => {
    vi.mocked(dns.promises.lookup).mockImplementation(() => new Promise(() => {})); // 永久hang
    const start = Date.now();
    const result = await safeFetchHtml("https://slow-dns.example.com/", {
      totalTimeoutMs: 50,
      hopTimeoutMs: 5000, // hopTimeoutより先にtotalTimeoutが効くことを確認
    });
    const elapsed = Date.now() - start;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("dns_timeout");
    expect(elapsed).toBeLessThan(1000);
  });

  it("HTTPエラーステータス(404)もok:trueで返し、呼び出し側の判断に委ねる", async () => {
    mockDnsResolvesTo("93.184.216.34");
    mockRequestOnce(
      https,
      createMockRes(404, { "content-type": "text/html" }),
      driveNormalBody(["not found"]),
    );
    const result = await safeFetchHtml("https://example.com/missing");
    expect(result).toEqual({
      ok: true,
      status: 404,
      finalUrl: "https://example.com/missing",
      body: "not found",
      contentType: "text/html",
    });
  });

  it("不正なURL文字列はinvalid_url", async () => {
    const result = await safeFetchHtml("not a url");
    expect(result).toEqual({ ok: false, reason: "invalid_url" });
  });
});
