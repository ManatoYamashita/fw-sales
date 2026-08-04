import { describe, expect, it } from "vitest";
import { canonicalizeUrl } from "../canonicalize";

describe("canonicalizeUrl", () => {
  it("既定ポート(http:80)を除去する", () => {
    const r = canonicalizeUrl("http://example.com:80/x");
    expect(r).toEqual({ ok: true, url: "http://example.com/x" });
  });

  it("既定ポート(https:443)を除去する", () => {
    const r = canonicalizeUrl("https://example.com:443/x");
    expect(r).toEqual({ ok: true, url: "https://example.com/x" });
  });

  it("非既定ポートは保持する", () => {
    const r = canonicalizeUrl("https://example.com:8443/x");
    expect(r).toEqual({ ok: true, url: "https://example.com:8443/x" });
  });

  it("hashを除去する", () => {
    const r = canonicalizeUrl("https://example.com/page#section");
    expect(r).toEqual({ ok: true, url: "https://example.com/page" });
  });

  it("utm_* パラメータを除去する(大文字小文字を問わない)", () => {
    const r = canonicalizeUrl("https://example.com/?utm_source=x&UTM_campaign=y&p=1");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.url).toBe("https://example.com/?p=1");
  });

  it("gclid / fbclid / yclid / _ga / mc_cid / mc_eid を除去する", () => {
    const r = canonicalizeUrl(
      "https://example.com/?gclid=a&fbclid=b&yclid=c&_ga=d&mc_cid=e&mc_eid=f&keep=1",
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.url).toBe("https://example.com/?keep=1");
  });

  it("utm等の除去後にqueryが空ならhanging ?を残さない", () => {
    const r = canonicalizeUrl("https://example.com/page?utm_source=x");
    expect(r).toEqual({ ok: true, url: "https://example.com/page" });
  });

  it("非trackingのqueryパラメータは順序を保って保持する", () => {
    const r = canonicalizeUrl("https://example.com/?b=2&a=1");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.url).toBe("https://example.com/?b=2&a=1");
  });

  it("hostnameをlowercaseにする", () => {
    const r = canonicalizeUrl("https://EXAMPLE.com/X");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.url).toBe("https://example.com/X");
  });

  it("credentials付きURLを拒否する", () => {
    const r = canonicalizeUrl("https://user:pass@example.com/");
    expect(r).toEqual({ ok: false, reason: "credentials_in_url" });
  });

  it("http/https以外のschemeを拒否する", () => {
    expect(canonicalizeUrl("ftp://example.com/")).toEqual({ ok: false, reason: "disallowed_scheme" });
    expect(canonicalizeUrl("javascript:alert(1)")).toEqual({ ok: false, reason: "disallowed_scheme" });
    expect(canonicalizeUrl("mailto:a@example.com")).toEqual({ ok: false, reason: "disallowed_scheme" });
    expect(canonicalizeUrl("data:text/html,<script>")).toEqual({ ok: false, reason: "disallowed_scheme" });
  });

  it("パース不能なURLを拒否する", () => {
    expect(canonicalizeUrl("not a url")).toEqual({ ok: false, reason: "invalid_url" });
    expect(canonicalizeUrl("")).toEqual({ ok: false, reason: "invalid_url" });
  });

  it("空pathは / になる", () => {
    const r = canonicalizeUrl("https://example.com");
    expect(r).toEqual({ ok: true, url: "https://example.com/" });
  });

  it("同一入力なら常に同一出力(決定性)", () => {
    const input = "https://EXAMPLE.com:443/a/b?utm_source=x&z=9&y=8#frag";
    expect(canonicalizeUrl(input)).toEqual(canonicalizeUrl(input));
  });
});
