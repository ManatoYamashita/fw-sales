/**
 * ルート `proxy.ts` の契約テスト。
 *
 * 主な検証観点:
 * - **export 契約**: Next.js の proxy ファイルは `proxy` という名前付き export か
 *   default export を持たねばならない (`next/dist/build/templates/middleware.js` が
 *   `mod.proxy || mod.default` しか見ない)。`middleware` のままだと**ビルドは通り、
 *   実行時に ProxyMissingExportError で落ちる**。CI は `pnpm build` を走らせないため、
 *   この事故を検知できるのはこのテストだけ。
 * - **matcher**: 保護対象 `(main)` 配下が match し、認証経路 / 法的ページ / API /
 *   静的アセット / メタ系ルートが match しないこと。matcher は正規表現の
 *   negative lookahead 1 本で組まれており、目視レビューでの検証が難しい。
 *
 * 注: 同梱ドキュメント (`node_modules/next/dist/docs/.../proxy.md`) は
 *     `unstable_doesProxyMatch` を使えと書いているが、**この関数は Next.js 16 の
 *     実装に存在しない** (docs の markdown にしか出現しない)。実在するのは
 *     `unstable_doesMiddlewareMatch` で、proxy の matcher も同じ仕組みで評価される。
 */

import { describe, expect, it } from "vitest";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";

import { config, proxy } from "../proxy";

const BASE = "https://example.test";

function matches(pathname: string): boolean {
  return unstable_doesMiddlewareMatch({
    config,
    url: `${BASE}${pathname}`,
  });
}

describe("proxy export 契約", () => {
  it("`proxy` という名前で関数を export している (ProxyMissingExportError 防止)", () => {
    expect(typeof proxy).toBe("function");
  });

  it("`config.matcher` を export している", () => {
    expect(Array.isArray(config.matcher)).toBe(true);
    expect(config.matcher).toHaveLength(1);
  });
});

describe("proxy config.matcher — 保護対象", () => {
  it.each([
    "/",
    "/stores",
    "/stores/new",
    "/stores/abc-123",
    "/stores/abc-123/edit",
    "/research",
    "/settings",
    // disabled ルート。matcher は通し、proxy 本体が /stores へリダイレクトする。
    "/dashboard",
    "/pipeline",
    "/actions",
    "/handoffs",
    "/kpi",
  ])("%s は proxy を通る", (pathname) => {
    expect(matches(pathname)).toBe(true);
  });
});

describe("proxy config.matcher — 除外対象", () => {
  it.each([
    // 認証経路自体 (ここを保護すると無限リダイレクトになる)
    "/login",
    "/auth/callback",
    // 未認証でも閲覧する法的ページ ((legal) Route Group)
    "/privacy",
    "/terms",
    // API 経路
    "/api/export",
    // Vercel Cron の宛先 (#242)。ここが matcher に入ると未認証リダイレクトが返り、
    // Vercel Cron は 3xx を「完了」として扱いログにも残さないため、keepalive が
    // 無言で死ぬ。除外され続けることをピン留めする。
    "/api/cron/keepalive",
    // Next.js 内部アセット
    "/_next/static/chunks/main.js",
    "/_next/image",
    // メタ系ルート (PWA install / SNS プレビュー / クローラー)
    "/favicon.ico",
    "/manifest.webmanifest",
    "/robots.txt",
    "/sitemap.xml",
    "/.well-known/assetlinks.json",
    // 拡張子付き静的アセット (public/ 配下)
    "/icon-192.png",
    "/logo.svg",
    "/fonts/inter.woff2",
  ])("%s は proxy を通らない", (pathname) => {
    expect(matches(pathname)).toBe(false);
  });
});
