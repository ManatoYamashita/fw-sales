/**
 * Next.js Root Proxy (auth-and-notifications spec, Issue #16)
 *
 * `(main)` Route Group 配下の全リクエストでセッション検証を行い、未認証なら
 * `/login?redirect={pathname}` にリダイレクトする。
 *
 * 制約:
 * - Node.js runtime で動作する。Next.js 16 で `middleware.ts` は `proxy.ts` に
 *   改名され、runtime は `nodejs` 固定で設定できない (`runtime` を export すると
 *   ビルドエラー)。ただし全リクエストの前段で走る経路であることは変わらないため、
 *   `postgres` 直接接続や重い依存をこのファイルに持ち込んではいけない。
 * - matcher で `(main)` 配下のみ対象、`/login` / `/auth/*` / `/api/*` /
 *   `/_next/*` / 静的アセット / favicon は除外
 * - 認証検証本体は `lib/supabase/proxy.ts:updateSession()` に委譲し、
 *   本ファイルはマッチパターンとリダイレクト発火に責務を絞る
 * - 関数名は `proxy` (または default export) でなければならない。`middleware` の
 *   ままだとビルドは通り実行時に `ProxyMissingExportError` で落ちる。
 *   `__tests__/proxy.test.ts` がこの契約を検証する。
 *
 * 関連: design.md §「middleware.ts」, requirements.md §1.1, §1.5
 */

import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";
import {
  FALLBACK_ENABLED_ROUTE,
  isDisabledPath,
} from "@/lib/domain/nav-routes";

export async function proxy(request: NextRequest) {
  const { response, isAuthenticated } = await updateSession(request);

  if (!isAuthenticated) {
    const redirectUrl = new URL("/login", request.url);
    redirectUrl.searchParams.set("redirect", request.nextUrl.pathname);
    return NextResponse.redirect(redirectUrl);
  }

  if (isDisabledPath(request.nextUrl.pathname)) {
    return NextResponse.redirect(new URL(FALLBACK_ENABLED_ROUTE, request.url));
  }

  return response;
}

export const config = {
  /*
   * 保護対象は `(main)` Route Group 配下の全ページ。除外は次の通り:
   * - `/login` / `/auth/*` (認証経路自体)
   * - `/privacy` / `/terms` (未認証でも閲覧する法的ページ。`(legal)` Route Group)
   * - `/api/*` (API 経路)
   * - `/_next/*` (Next.js 内部アセット)
   * - 拡張子付き静的アセット (favicon / public/ 配下)
   * - `manifest.webmanifest` / `robots.txt` / `sitemap.xml` / `.well-known/*`
   *   など、未認証でもアクセスされうるメタ系ルート
   *   (PWA install / SNS リンクプレビュー / クローラー)
   */
  matcher: [
    "/((?!login|auth|privacy|terms|api|_next/static|_next/image|favicon\\.ico|manifest\\.webmanifest|robots\\.txt|sitemap\\.xml|\\.well-known/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|css|js|mjs|woff|woff2|ttf|otf|map|txt|xml|webmanifest)$).*)",
  ],
};
