import { describe, expect, it } from "vitest";
import { filterCrawlCandidateLink, type FilterContext } from "../link-filter";

function ctx(overrides: Partial<FilterContext> = {}): FilterContext {
  return {
    baseUrl: "https://example.com/",
    effectiveOrigin: "https://example.com",
    homepageUrl: "https://example.com/",
    visited: new Set<string>(),
    ...overrides,
  };
}

describe("filterCrawlCandidateLink", () => {
  it("正当なsame-originリンクを受理する", () => {
    const result = filterCrawlCandidateLink({ href: "/menu", anchorText: "メニュー" }, ctx());
    expect(result).toEqual({ ok: true, url: "https://example.com/menu" });
  });

  it("http/https以外(mailto/tel/javascript/data)を除外する", () => {
    expect(filterCrawlCandidateLink({ href: "mailto:a@example.com", anchorText: "" }, ctx())).toEqual({
      ok: false,
      reason: "non_http_scheme",
    });
    expect(filterCrawlCandidateLink({ href: "tel:0311112222", anchorText: "" }, ctx())).toEqual({
      ok: false,
      reason: "non_http_scheme",
    });
    expect(filterCrawlCandidateLink({ href: "javascript:void(0)", anchorText: "" }, ctx())).toEqual({
      ok: false,
      reason: "non_http_scheme",
    });
    expect(filterCrawlCandidateLink({ href: "data:text/html,x", anchorText: "" }, ctx())).toEqual({
      ok: false,
      reason: "non_http_scheme",
    });
  });

  it("off-siteリンクを除外する", () => {
    const result = filterCrawlCandidateLink({ href: "https://other.com/page", anchorText: "" }, ctx());
    expect(result).toEqual({ ok: false, reason: "offsite" });
  });

  it("portal(Tabelog等)を除外する", () => {
    const result = filterCrawlCandidateLink(
      { href: "https://tabelog.com/x", anchorText: "" },
      ctx({ effectiveOrigin: "https://tabelog.com" }),
    );
    expect(result).toEqual({ ok: false, reason: "portal" });
  });

  it("fragment-onlyリンク(同一ページの#アンカー)を除外する", () => {
    const result = filterCrawlCandidateLink({ href: "#menu", anchorText: "" }, ctx());
    expect(result).toEqual({ ok: false, reason: "fragment_only" });
  });

  it("別ページへのfragment付きリンクはfragment-only扱いしない", () => {
    const result = filterCrawlCandidateLink({ href: "/access#map", anchorText: "" }, ctx());
    expect(result).toEqual({ ok: true, url: "https://example.com/access" });
  });

  describe("fragment 除外は visited に依存せず filter 単体で保証する(MEDIUM-4 回帰)", () => {
    // visited は常に空。それでも自ページが候補にならないことを確認する。
    it('href="#" は homepage を base にしても fragment_only', () => {
      expect(filterCrawlCandidateLink({ href: "#", anchorText: "" }, ctx())).toEqual({
        ok: false,
        reason: "fragment_only",
      });
    });

    it('href="#" は subpage を base にしても fragment_only(自ページを再candidate化しない)', () => {
      const result = filterCrawlCandidateLink(
        { href: "#", anchorText: "" },
        ctx({ baseUrl: "https://example.com/menu" }),
      );
      expect(result).toEqual({ ok: false, reason: "fragment_only" });
    });

    it('href="#menu" は subpage を base にしても fragment_only', () => {
      const result = filterCrawlCandidateLink(
        { href: "#menu", anchorText: "" },
        ctx({ baseUrl: "https://example.com/access" }),
      );
      expect(result).toEqual({ ok: false, reason: "fragment_only" });
    });

    it("前後の空白を含む '  #top  ' も fragment_only", () => {
      expect(filterCrawlCandidateLink({ href: "  #top  ", anchorText: "" }, ctx())).toEqual({
        ok: false,
        reason: "fragment_only",
      });
    });

    it("subpage base でも別ページへの fragment 付きリンクは候補に残る", () => {
      const result = filterCrawlCandidateLink(
        { href: "/access#map", anchorText: "" },
        ctx({ baseUrl: "https://example.com/menu" }),
      );
      expect(result).toEqual({ ok: true, url: "https://example.com/access" });
    });

    it("自ページを絶対URL + hash で書いた場合も fragment_only", () => {
      const result = filterCrawlCandidateLink(
        { href: "https://example.com/menu#top", anchorText: "" },
        ctx({ baseUrl: "https://example.com/menu" }),
      );
      expect(result).toEqual({ ok: false, reason: "fragment_only" });
    });
  });

  it("download拡張子を除外する", () => {
    for (const ext of ["pdf", "jpg", "png", "zip", "docx", "mp4"]) {
      const result = filterCrawlCandidateLink({ href: `/file.${ext}`, anchorText: "" }, ctx());
      expect(result).toEqual({ ok: false, reason: "download_extension" });
    }
  });

  it("login/admin/cart等の非対象導線を除外する", () => {
    for (const path of ["/login", "/wp-admin/", "/cart", "/checkout", "/mypage", "/privacy-policy"]) {
      const result = filterCrawlCandidateLink({ href: path, anchorText: "" }, ctx());
      expect(result).toEqual({ ok: false, reason: "non_target_path" });
    }
  });

  it("visited済みのURLを除外する", () => {
    const result = filterCrawlCandidateLink(
      { href: "/menu", anchorText: "" },
      ctx({ visited: new Set(["https://example.com/menu"]) }),
    );
    expect(result).toEqual({ ok: false, reason: "already_visited" });
  });

  it("homepage自身を除外する", () => {
    const result = filterCrawlCandidateLink({ href: "/", anchorText: "" }, ctx());
    expect(result).toEqual({ ok: false, reason: "is_homepage" });
  });

  it("パース不能なhrefを除外する", () => {
    const result = filterCrawlCandidateLink({ href: "http://[invalid", anchorText: "" }, ctx());
    expect(result.ok).toBe(false);
  });

  it("credentials付きURLを除外する", () => {
    const result = filterCrawlCandidateLink(
      { href: "https://user:pass@example.com/x", anchorText: "" },
      ctx(),
    );
    expect(result).toEqual({ ok: false, reason: "credentials_in_url" });
  });

  it("相対パスをbaseUrlに対して絶対化する", () => {
    const result = filterCrawlCandidateLink(
      { href: "menu/lunch", anchorText: "" },
      ctx({ baseUrl: "https://example.com/store/" }),
    );
    expect(result).toEqual({ ok: true, url: "https://example.com/store/menu/lunch" });
  });
});
