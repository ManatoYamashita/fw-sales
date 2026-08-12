/**
 * trust-critical な URL 正規化の単体検証
 * (feat/ai-research-quality-ux-hardening、Plan §8.2.1 / 承認レビュー指摘2)。
 *
 * この正規化は2つの用途で使う:
 * 1. `applyUrlContextStatus` の突合キー(取りこぼし修正)
 * 2. official alias 判定の厳格一致(**trust 判定に直結**)
 *
 * 2 の用途があるため、**false positive より false negative を優先**する。
 * `www.` 除去や origin-only 一致のような「同じサイトっぽい」正規化は禁止。
 */

import { describe, it, expect } from "vitest";
import { normalizeUrlForMatch, isStrictSameUrl } from "../url-normalize";

describe("normalizeUrlForMatch — 許可する正規化", () => {
  it("schemeを小文字化する", () => {
    expect(normalizeUrlForMatch("HTTPS://robata-jun.com/")).toBe(
      normalizeUrlForMatch("https://robata-jun.com/"),
    );
  });

  it("hostnameを小文字化する", () => {
    expect(normalizeUrlForMatch("https://Robata-Jun.COM/")).toBe(
      normalizeUrlForMatch("https://robata-jun.com/"),
    );
  });

  it("fragmentを除去する", () => {
    expect(normalizeUrlForMatch("https://robata-jun.com/#menu")).toBe(
      normalizeUrlForMatch("https://robata-jun.com/"),
    );
  });

  it("default portを正規化する", () => {
    expect(normalizeUrlForMatch("https://robata-jun.com:443/")).toBe(
      normalizeUrlForMatch("https://robata-jun.com/"),
    );
    expect(normalizeUrlForMatch("http://example.test:80/a")).toBe(
      normalizeUrlForMatch("http://example.test/a"),
    );
  });

  it("root URLの末尾slash有無を同一視する", () => {
    expect(normalizeUrlForMatch("https://robata-jun.com")).toBe(
      normalizeUrlForMatch("https://robata-jun.com/"),
    );
  });
});

describe("normalizeUrlForMatch — 禁止する正規化(false negative を優先)", () => {
  it("www. を自動除去しない(別ホストの可能性がある)", () => {
    expect(normalizeUrlForMatch("https://www.robata-jun.com/")).not.toBe(
      normalizeUrlForMatch("https://robata-jun.com/"),
    );
  });

  it("root以外のpathの末尾slashは落とさない", () => {
    expect(normalizeUrlForMatch("https://robata-jun.com/menu/")).not.toBe(
      normalizeUrlForMatch("https://robata-jun.com/menu"),
    );
  });

  it("queryを捨てない", () => {
    expect(normalizeUrlForMatch("https://robata-jun.com/?a=1")).not.toBe(
      normalizeUrlForMatch("https://robata-jun.com/"),
    );
    expect(normalizeUrlForMatch("https://robata-jun.com/?a=1")).not.toBe(
      normalizeUrlForMatch("https://robata-jun.com/?a=2"),
    );
  });

  it("pathが違えば別URLとして扱う(origin-only matchをしない)", () => {
    expect(normalizeUrlForMatch("https://robata-jun.com/a")).not.toBe(
      normalizeUrlForMatch("https://robata-jun.com/b"),
    );
  });

  it("hostが違えば別URL", () => {
    expect(normalizeUrlForMatch("https://robata-jun.com/")).not.toBe(
      normalizeUrlForMatch("https://robata-jun.example/"),
    );
  });

  it("schemeが違えば別URL(https→httpのダウングレードを同一視しない)", () => {
    expect(normalizeUrlForMatch("https://robata-jun.com/")).not.toBe(
      normalizeUrlForMatch("http://robata-jun.com/"),
    );
  });
});

describe("normalizeUrlForMatch — パースできない入力", () => {
  it("URLとして解釈できない場合はnullを返す(誤って一致させない)", () => {
    expect(normalizeUrlForMatch("not a url")).toBeNull();
    expect(normalizeUrlForMatch("")).toBeNull();
  });

  it("http/https以外のschemeはnullを返す", () => {
    expect(normalizeUrlForMatch("ftp://robata-jun.com/")).toBeNull();
    expect(normalizeUrlForMatch("javascript:alert(1)")).toBeNull();
  });
});

describe("isStrictSameUrl (alias判定の厳格一致)", () => {
  it("正規化後に完全一致すればtrue", () => {
    expect(isStrictSameUrl("HTTPS://Robata-Jun.com:443/#x", "https://robata-jun.com/")).toBe(true);
  });

  it("www.の有無だけの違いはfalse", () => {
    expect(isStrictSameUrl("https://www.robata-jun.com/", "https://robata-jun.com/")).toBe(false);
  });

  it("同一originでもpathが違えばfalse", () => {
    expect(isStrictSameUrl("https://robata-jun.com/menu", "https://robata-jun.com/")).toBe(false);
  });

  it("どちらかがパース不能ならfalse", () => {
    expect(isStrictSameUrl("not a url", "https://robata-jun.com/")).toBe(false);
    expect(isStrictSameUrl("https://robata-jun.com/", "")).toBe(false);
  });
});
