/**
 * DNS pinning 用 lookup の **Node ランタイム契約** 検証
 * (PR #180 final smoke hardening、Issue A の root cause)。
 *
 * ## なぜ別ファイルなのか
 *
 * `source-url-resolver.test.ts` は `node:https` と `node:dns` を丸ごと mock するため、
 * **custom `lookup` が Node の実 connect パスからどう呼ばれるか**を一切検証できない。
 * 実際、その盲点のせいで以下の不具合が本番まで到達した。
 *
 * ## 再現した不具合(実機: 炉端ジュン、alias resolve 8件中0件成功)
 *
 * Node 20 以降 `net` の `autoSelectFamily` が既定で **true** になり、
 * `net.Socket.connect` は custom `lookup` を **`{ all: true }`** 付きで呼び、
 * コールバックへ **`LookupAddress[]`(配列)** が返ることを期待する。
 * 旧実装は `options.all` を無視して常に `callback(null, address, family)` の
 * スカラー形式で返していたため、Node 側が `addresses[0].address` を読んで
 * `undefined` を得て `ERR_INVALID_IP_ADDRESS: Invalid IP address: undefined` で
 * 即座に失敗していた。
 *
 * → resolver は**ネットワークに出る前に毎回失敗**し、
 *   `resolveOfficialAliases` は常に `merged: 0` になっていた。
 *
 * 本ファイルは `node:https` / `node:dns` を mock せず、**実際の Node connect パス**で
 * ローカル HTTP サーバへ接続して契約を固定する(外部通信は一切しない)。
 */

import { describe, it, expect } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import net from "node:net";

import { createPinnedLookup } from "../source-url-resolver";

type LookupCb = (
  err: NodeJS.ErrnoException | null,
  address: string | { address: string; family: number }[],
  family?: number,
) => void;

describe("createPinnedLookup — Node の lookup 契約", () => {
  it("options.all === true では LookupAddress[] を返す(autoSelectFamily 対応)", () => {
    const lookup = createPinnedLookup("93.184.216.34", 4);
    let received: unknown;
    lookup("example.test", { all: true } as never, ((_e: unknown, addr: unknown) => {
      received = addr;
    }) as never);

    expect(Array.isArray(received)).toBe(true);
    expect(received).toEqual([{ address: "93.184.216.34", family: 4 }]);
  });

  it("options.all が false/未指定ならスカラー形式 (address, family) を返す", () => {
    const lookup = createPinnedLookup("93.184.216.34", 4);
    const calls: unknown[][] = [];
    lookup("example.test", { all: false } as never, ((...args: unknown[]) => {
      calls.push(args);
    }) as never);
    lookup("example.test", {} as never, ((...args: unknown[]) => {
      calls.push(args);
    }) as never);

    expect(calls[0]).toEqual([null, "93.184.216.34", 4]);
    expect(calls[1]).toEqual([null, "93.184.216.34", 4]);
  });

  it("options 省略形 (hostname, callback) でもスカラー形式で返す", () => {
    const lookup = createPinnedLookup("::1", 6);
    const calls: unknown[][] = [];
    (lookup as unknown as (h: string, cb: LookupCb) => void)("example.test", ((
      ...args: unknown[]
    ) => {
      calls.push(args);
    }) as never);

    expect(calls[0]).toEqual([null, "::1", 6]);
  });

  it("IPv6 を pin した場合も family=6 の配列を返す", () => {
    const lookup = createPinnedLookup("2606:2800:220:1:248:1893:25c8:1946", 6);
    let received: unknown;
    lookup("example.test", { all: true } as never, ((_e: unknown, addr: unknown) => {
      received = addr;
    }) as never);

    expect(received).toEqual([
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
    ]);
  });
});

/**
 * **実 Node スタックでの回帰テスト。**
 *
 * `node:https` を mock しないため、`autoSelectFamily` を含む本物の connect パスを通る。
 * このテストが緑であることが「本番で resolver が接続できる」ことの根拠になる。
 */
describe("createPinnedLookup — 実 connect パスでの疎通(ローカルサーバのみ)", () => {
  it("pinned lookup 経由で HEAD リクエストが成立し、302 の location を取得できる", async () => {
    const server = http.createServer((req, res) => {
      res.writeHead(302, { location: "https://example.test/final" });
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const result = await new Promise<{ status?: number; location?: string; error?: string }>(
        (resolve) => {
          const req = http.request(
            {
              method: "HEAD",
              hostname: "resolver-probe.test",
              port,
              path: "/x",
              // 実装と同じ形の pinned lookup。旧実装(常にスカラー)だと
              // ERR_INVALID_IP_ADDRESS で失敗する。
              lookup: createPinnedLookup("127.0.0.1", 4),
              timeout: 3000,
            },
            (res) => {
              res.destroy();
              resolve({ status: res.statusCode, location: res.headers.location });
            },
          );
          req.on("timeout", () => {
            req.destroy(new Error("hop_timeout"));
          });
          req.on("error", (err) => resolve({ error: (err as NodeJS.ErrnoException).code ?? err.message }));
          req.end();
        },
      );

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(302);
      expect(result.location).toBe("https://example.test/final");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("テストの検知能力の確認: 旧実装(常にスカラー返し)は実 connect パスで失敗する", async () => {
    // autoSelectFamily が既定 true の環境でのみ意味を持つメタテスト。
    // 将来 Node の既定が変わった場合はここが黄信号になる。
    const autoSelect =
      typeof net.getDefaultAutoSelectFamily === "function"
        ? net.getDefaultAutoSelectFamily()
        : false;
    if (!autoSelect) return;

    const server = http.createServer((_req, res) => {
      res.writeHead(200);
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const legacyLookup = ((_hostname: string, options: unknown, callback: LookupCb) => {
        if (typeof options === "function") {
          (options as unknown as LookupCb)(null, "127.0.0.1", 4);
          return;
        }
        // 旧実装: options.all を無視して常にスカラーを返す
        callback(null, "127.0.0.1", 4);
      }) as never;

      const error = await new Promise<string | undefined>((resolve) => {
        const req = http.request(
          { method: "HEAD", hostname: "resolver-probe.test", port, path: "/x", lookup: legacyLookup, timeout: 3000 },
          (res) => {
            res.destroy();
            resolve(undefined);
          },
        );
        req.on("timeout", () => req.destroy(new Error("hop_timeout")));
        req.on("error", (err) => resolve((err as NodeJS.ErrnoException).code ?? err.message));
        req.end();
      });

      expect(error).toBe("ERR_INVALID_IP_ADDRESS");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
