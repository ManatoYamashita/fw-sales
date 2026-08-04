import { describe, expect, it, vi, afterEach } from "vitest";
import * as dns from "node:dns";
import {
  isAllowedScheme,
  hasCredentials,
  stripIPv6Brackets,
  isDisallowedIPv4,
  isDisallowedIPv6,
  isDisallowedAddress,
  validateExternalUrl,
  createPinnedLookup,
} from "../url-safety";

vi.mock("node:dns", () => ({
  promises: { lookup: vi.fn() },
}));

describe("isAllowedScheme", () => {
  it("http/httpsを許可する", () => {
    expect(isAllowedScheme("http:")).toBe(true);
    expect(isAllowedScheme("https:")).toBe(true);
  });

  it("file/ftp/data/javascript/gopherを拒否する", () => {
    expect(isAllowedScheme("file:")).toBe(false);
    expect(isAllowedScheme("ftp:")).toBe(false);
    expect(isAllowedScheme("data:")).toBe(false);
    expect(isAllowedScheme("javascript:")).toBe(false);
    expect(isAllowedScheme("gopher:")).toBe(false);
  });

  it("allowedSchemesを明示指定した場合はそれに従う(https限定)", () => {
    expect(isAllowedScheme("http:", ["https:"])).toBe(false);
    expect(isAllowedScheme("https:", ["https:"])).toBe(true);
  });
});

describe("hasCredentials", () => {
  it("user:pass@host形式を検出する", () => {
    expect(hasCredentials(new URL("https://user:pass@example.com/"))).toBe(true);
  });
  it("credentials無しはfalse", () => {
    expect(hasCredentials(new URL("https://example.com/"))).toBe(false);
  });
});

describe("stripIPv6Brackets", () => {
  it("角括弧を除去する", () => {
    expect(stripIPv6Brackets("[::1]")).toBe("::1");
  });
  it("角括弧が無ければそのまま", () => {
    expect(stripIPv6Brackets("example.com")).toBe("example.com");
  });
});

describe("isDisallowedIPv4", () => {
  it.each([
    ["0.0.0.0", true],
    ["10.0.0.1", true],
    ["10.255.255.255", true],
    ["100.64.0.1", true],
    ["100.127.255.255", true],
    ["127.0.0.1", true],
    ["127.255.255.255", true],
    ["169.254.169.254", true], // cloud metadata endpoint
    ["169.254.0.1", true],
    ["172.16.0.1", true],
    ["172.31.255.255", true],
    ["192.0.0.1", true],
    ["192.168.1.1", true],
    ["198.18.0.1", true],
    ["198.19.255.255", true],
    ["224.0.0.1", true],
    ["255.255.255.255", true],
    ["8.8.8.8", false],
    ["1.1.1.1", false],
    ["93.184.216.34", false],
    ["172.15.255.255", false], // 172.16/12の直前(許可されるべき)
    ["172.32.0.0", false], // 172.16/12の直後(許可されるべき)
    ["100.63.255.255", false], // 100.64/10の直前
    ["100.128.0.0", false], // 100.64/10の直後
  ])("%s => disallowed=%s", (addr, expected) => {
    expect(isDisallowedIPv4(addr)).toBe(expected);
  });

  it("不正な形式は安全側で拒否", () => {
    expect(isDisallowedIPv4("not.an.ip.address")).toBe(true);
    expect(isDisallowedIPv4("1.2.3")).toBe(true);
    expect(isDisallowedIPv4("1.2.3.4.5")).toBe(true);
    expect(isDisallowedIPv4("256.0.0.1")).toBe(true);
  });
});

describe("isDisallowedIPv6", () => {
  it.each([
    ["::1", true], // loopback
    ["::", true], // unspecified
    ["fe80::1", true], // link-local
    ["FE80::1", true], // 大文字小文字混在
    ["fc00::1", true], // unique local
    ["fd00::1", true], // unique local(fd00側)
    ["2001:db8::1", true], // documentation
    ["64:ff9b::192.0.2.33", true], // NAT64(埋め込みIPv4形式)
    ["ff02::1", true], // multicast
    ["2606:4700:4700::1111", false], // 実在の公開IPv6(Cloudflare DNS、許可されるべき)
    ["2001:4860:4860::8888", false], // 実在の公開IPv6(Google DNS、許可されるべき)
  ])("%s => disallowed=%s", (addr, expected) => {
    expect(isDisallowedIPv6(addr)).toBe(expected);
  });

  describe("IPv4-mapped IPv6のbypass修正(実装前レビューで発見)", () => {
    it("dotted-decimal形式 ::ffff:127.0.0.1 を拒否する", () => {
      expect(isDisallowedIPv6("::ffff:127.0.0.1")).toBe(true);
    });
    it("hex-group形式 ::ffff:7f00:1 (new URL()正規化後の形式)も同じアドレスとして拒否する", () => {
      expect(isDisallowedIPv6("::ffff:7f00:1")).toBe(true);
    });
    it("IPv4-mapped私設アドレス以外の埋め込み(公開IP)は許可する", () => {
      expect(isDisallowedIPv6("::ffff:8.8.8.8")).toBe(false);
      expect(isDisallowedIPv6("::ffff:808:808")).toBe(false); // 8.8.8.8のhex-group形式
    });
    it("metadata endpoint(169.254.169.254)のmapped表現も拒否する", () => {
      expect(isDisallowedIPv6("::ffff:169.254.169.254")).toBe(true);
      expect(isDisallowedIPv6("::ffff:a9fe:a9fe")).toBe(true); // 169.254.169.254のhex-group形式
    });
  });

  describe("IPv4-compatible IPv6 (::/96、RFC 4291 §2.5.5.1、非推奨)のbypass修正(commit前review BLOCKERで発見)", () => {
    it("dotted-decimal形式 ::127.0.0.1 を拒否する", () => {
      expect(isDisallowedIPv6("::127.0.0.1")).toBe(true);
    });
    it("hex-group形式 ::7f00:1 (new URL()正規化後の形式)も同じアドレスとして拒否する", () => {
      expect(isDisallowedIPv6("::7f00:1")).toBe(true);
    });
    it("cloud metadata endpoint(::169.254.169.254 / ::a9fe:a9fe)を拒否する", () => {
      expect(isDisallowedIPv6("::169.254.169.254")).toBe(true);
      expect(isDisallowedIPv6("::a9fe:a9fe")).toBe(true);
    });
    it("private range(::10.0.0.1 / ::a00:1)を拒否する", () => {
      expect(isDisallowedIPv6("::10.0.0.1")).toBe(true);
      expect(isDisallowedIPv6("::a00:1")).toBe(true);
    });
    it("既存の ::(unspecified) / ::1(loopback) 判定は変わらず維持される", () => {
      expect(isDisallowedIPv6("::")).toBe(true);
      expect(isDisallowedIPv6("::1")).toBe(true);
    });
    it("::ffff:0:7f00:1 (ffff位置がずれた別アドレス、127.0.0.1とは非等価)は許可のまま", () => {
      // groups=[0,0,0,0,0xffff,0,0x7f00,1] — 標準mapped形式(groups[5]===0xffff)とは
      // ffffの位置が1つずれており、127.0.0.1の別表記ではない(commit前reviewで確認済み)。
      expect(isDisallowedIPv6("::ffff:0:7f00:1")).toBe(false);
    });
  });

  it("不正な形式(パース不能)は安全側で拒否", () => {
    expect(isDisallowedIPv6("not-an-ipv6-address")).toBe(true);
    expect(isDisallowedIPv6(":::1")).toBe(true);
    expect(isDisallowedIPv6("1:2:3:4:5:6:7:8:9")).toBe(true);
  });
});

describe("isDisallowedAddress", () => {
  it("IPv4/IPv6を振り分けて判定する", () => {
    expect(isDisallowedAddress("127.0.0.1")).toBe(true);
    expect(isDisallowedAddress("::1")).toBe(true);
    expect(isDisallowedAddress("8.8.8.8")).toBe(false);
  });
  it("IPと認識できない文字列は安全側で拒否", () => {
    expect(isDisallowedAddress("example.com")).toBe(true);
  });
});

describe("validateExternalUrl", () => {
  it("非HTTP(S)スキームを拒否する", async () => {
    const result = await validateExternalUrl(new URL("file:///etc/passwd"));
    expect(result).toEqual({ ok: false, reason: "disallowed_scheme" });
  });

  it("credentials付きURLを拒否する", async () => {
    const result = await validateExternalUrl(new URL("https://user:pass@example.com/"));
    expect(result).toEqual({ ok: false, reason: "credentials_in_url" });
  });

  it("IPv4 literalホストは、拒否レンジならDNS解決せず即座に拒否する", async () => {
    const result = await validateExternalUrl(new URL("http://127.0.0.1/"));
    expect(result).toEqual({ ok: false, reason: "disallowed_ip_range" });
  });

  it("数値表記難読化(2130706433)は new URL() が127.0.0.1へ正規化するため拒否される", async () => {
    const url = new URL("http://2130706433/");
    expect(url.hostname).toBe("127.0.0.1"); // new URL() 自体の正規化を固定するテスト
    const result = await validateExternalUrl(url);
    expect(result).toEqual({ ok: false, reason: "disallowed_ip_range" });
  });

  it("IPv6 literal([::1])は角括弧を除去したうえで拒否レンジ判定する(既知バグ修正の確認)", async () => {
    const url = new URL("http://[::1]/");
    expect(url.hostname).toBe("[::1]"); // ブラケット付きで返ることを固定
    const result = await validateExternalUrl(url);
    expect(result).toEqual({ ok: false, reason: "disallowed_ip_range" });
  });

  it("cloud metadata endpoint (169.254.169.254) を拒否する", async () => {
    const result = await validateExternalUrl(new URL("http://169.254.169.254/latest/meta-data/"));
    expect(result).toEqual({ ok: false, reason: "disallowed_ip_range" });
  });

  describe("URL normalization bypassパターンの回帰テスト(commit前reviewで指摘、CIで固定)", () => {
    it.each([
      ["http://127.1/", "127.0.0.1"],
      ["http://0x7f000001/", "127.0.0.1"],
      ["http://0177.0.0.1/", "127.0.0.1"],
      ["http://127.0.0.1./", "127.0.0.1"],
    ])("%s は new URL() が %s へ正規化し拒否される", async (input, expectedHostname) => {
      const url = new URL(input);
      expect(url.hostname).toBe(expectedHostname);
      const result = await validateExternalUrl(url);
      expect(result).toEqual({ ok: false, reason: "disallowed_ip_range" });
    });

    it.each([
      "http://[::127.0.0.1]/",
      "http://[::10.0.0.1]/",
      "http://[::169.254.169.254]/",
    ])("IPv4-compatible IPv6 literal %s を拒否する", async (input) => {
      const result = await validateExternalUrl(new URL(input));
      expect(result).toEqual({ ok: false, reason: "disallowed_ip_range" });
    });
  });

  describe("DNS lookupが必要なホスト名(node:dns をモック)", () => {
    afterEach(() => {
      vi.mocked(dns.promises.lookup).mockReset();
    });

    it("public IPへ解決される場合は許可する", async () => {
      vi.mocked(dns.promises.lookup).mockResolvedValue([
        { address: "93.184.216.34", family: 4 },
      ] as never);
      const result = await validateExternalUrl(new URL("https://example.com/"));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.resolvedAddresses).toEqual([{ address: "93.184.216.34", family: 4 }]);
      }
    });

    it("private IPへ解決される場合は拒否する", async () => {
      vi.mocked(dns.promises.lookup).mockResolvedValue([
        { address: "10.0.0.5", family: 4 },
      ] as never);
      const result = await validateExternalUrl(new URL("https://internal.example.com/"));
      expect(result).toEqual({ ok: false, reason: "disallowed_ip_range" });
    });

    it("DNS解決が失敗する場合はdns_lookup_failed", async () => {
      vi.mocked(dns.promises.lookup).mockRejectedValue(new Error("ENOTFOUND"));
      const result = await validateExternalUrl(new URL("https://nonexistent.invalid/"));
      expect(result).toEqual({ ok: false, reason: "dns_lookup_failed" });
    });

    it("DNS解決結果が空配列の場合はdns_no_records", async () => {
      vi.mocked(dns.promises.lookup).mockResolvedValue([] as never);
      const result = await validateExternalUrl(new URL("https://empty-records.example.com/"));
      expect(result).toEqual({ ok: false, reason: "dns_no_records" });
    });

    it("DNS解決が指定timeoutを超えてhangする場合はdns_timeoutを返し、待機時間を超過しない", async () => {
      vi.mocked(dns.promises.lookup).mockImplementation(
        () => new Promise(() => {}), // 永久に解決しないPromise(hangを模擬)
      );
      const start = Date.now();
      const result = await validateExternalUrl(new URL("https://slow-dns.example.com/"), {
        dnsTimeoutMs: 50,
      });
      const elapsed = Date.now() - start;
      expect(result).toEqual({ ok: false, reason: "dns_timeout" });
      expect(elapsed).toBeLessThan(500); // 50ms指定に対し十分な余裕を持った上限
    });
  });
});

describe("createPinnedLookup", () => {
  it("常に先頭のアドレスをcallbackへ渡す", () => {
    const lookup = createPinnedLookup([
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
    ]);
    const cb = vi.fn();
    lookup("example.com", {}, cb);
    expect(cb).toHaveBeenCalledWith(null, "93.184.216.34", 4);
  });

  it("optionsが関数(4引数省略形)の場合もcallbackとして扱う", () => {
    const lookup = createPinnedLookup([{ address: "1.1.1.1", family: 4 }]);
    const cb = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (lookup as any)("example.com", cb);
    expect(cb).toHaveBeenCalledWith(null, "1.1.1.1", 4);
  });

  it("addressesが空の場合はthrow", () => {
    expect(() => createPinnedLookup([])).toThrow();
  });

  it("options.all===trueの場合はNode Happy Eyeballs形式(配列)でcallbackを呼ぶ(実機smokeで発見した既知バグの回帰テスト)", () => {
    const lookup = createPinnedLookup([
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
    ]);
    const cb = vi.fn();
    lookup("example.com", { all: true }, cb);
    expect(cb).toHaveBeenCalledWith(null, [
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
    ]);
  });

  it("options.all===falseまたは未指定の場合は単一形式のまま", () => {
    const lookup = createPinnedLookup([{ address: "93.184.216.34", family: 4 }]);
    const cb = vi.fn();
    lookup("example.com", { all: false }, cb);
    expect(cb).toHaveBeenCalledWith(null, "93.184.216.34", 4);
  });

  describe("options.family契約(commit前review MEDIUM findingの修正)", () => {
    const mixedAddresses = [
      { address: "93.184.216.34", family: 4 as const },
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 as const },
    ];

    it("family:4指定時はIPv4アドレスのみを返す", () => {
      const lookup = createPinnedLookup(mixedAddresses);
      const cb = vi.fn();
      lookup("example.com", { family: 4 }, cb);
      expect(cb).toHaveBeenCalledWith(null, "93.184.216.34", 4);
    });

    it("family:6指定時はIPv6アドレスのみを返す", () => {
      const lookup = createPinnedLookup(mixedAddresses);
      const cb = vi.fn();
      lookup("example.com", { family: 6 }, cb);
      expect(cb).toHaveBeenCalledWith(
        null,
        "2606:2800:220:1:248:1893:25c8:1946",
        6,
      );
    });

    it("family:4 + all:trueの場合、IPv4のみの配列を返す", () => {
      const lookup = createPinnedLookup(mixedAddresses);
      const cb = vi.fn();
      lookup("example.com", { family: 4, all: true }, cb);
      expect(cb).toHaveBeenCalledWith(null, [{ address: "93.184.216.34", family: 4 }]);
    });

    it("family:6 + all:trueの場合、IPv6のみの配列を返す", () => {
      const lookup = createPinnedLookup(mixedAddresses);
      const cb = vi.fn();
      lookup("example.com", { family: 6, all: true }, cb);
      expect(cb).toHaveBeenCalledWith(null, [
        { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
      ]);
    });

    it("該当familyのアドレスが存在しない場合、ENOTFOUND errorをcallbackへ渡す(単一形式)", () => {
      const lookup = createPinnedLookup([{ address: "93.184.216.34", family: 4 }]);
      const cb = vi.fn();
      lookup("example.com", { family: 6 }, cb);
      expect(cb).toHaveBeenCalledTimes(1);
      const [err, address, family] = cb.mock.calls[0]!;
      expect((err as NodeJS.ErrnoException)?.code).toBe("ENOTFOUND");
      expect(address).toBe("");
      expect(family).toBe(0);
    });

    it("該当familyのアドレスが存在しない場合、ENOTFOUND errorをcallbackへ渡す(all形式)", () => {
      const lookup = createPinnedLookup([{ address: "93.184.216.34", family: 4 }]);
      const cb = vi.fn();
      lookup("example.com", { family: 6, all: true }, cb);
      expect(cb).toHaveBeenCalledTimes(1);
      const [err, addresses] = cb.mock.calls[0]!;
      expect((err as NodeJS.ErrnoException)?.code).toBe("ENOTFOUND");
      expect(addresses).toEqual([]);
    });

    it("family未指定はfilterせず全アドレスを対象にする(既存挙動維持)", () => {
      const lookup = createPinnedLookup(mixedAddresses);
      const cb = vi.fn();
      lookup("example.com", { all: true }, cb);
      expect(cb).toHaveBeenCalledWith(null, [
        { address: "93.184.216.34", family: 4 },
        { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
      ]);
    });
  });
});
