/**
 * Next.js Root Middleware (auth-and-notifications spec, Issue #16)
 *
 * `(main)` Route Group 配下の全リクエストでセッション検証を行い、未認証なら
 * `/login?redirect={pathname}` にリダイレクトする。
 *
 * 制約:
 * - Edge Runtime で動作する (`postgres` 直接接続は不可)
 * - matcher で `(main)` 配下のみ対象、`/login` / `/auth/*` / `/api/*` /
 *   `/_next/*` / 静的アセット / favicon は除外
 * - 認証検証本体は `lib/supabase/middleware.ts:updateSession()` に委譲し、
 *   本ファイルはマッチパターンとリダイレクト発火に責務を絞る
 *
 * 関連: design.md §「middleware.ts」, requirements.md §1.1, §1.5
 */

import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * 一時的に利用不可にしているメニューの URL プレフィクス。
 * `lib/domain/nav.ts` の `NAV_ITEMS[].disabled` と整合させる単一の真実とし、
 * 解除する際は両者を同時に戻す。
 */
const DISABLED_ROUTE_PREFIXES: readonly string[] = [
  "/dashboard",
  "/research",
  "/pipeline",
  "/actions",
  "/deals",
  "/handoffs",
  "/kpi",
];

const FALLBACK_ENABLED_ROUTE = "/stores";

function isDisabledPath(pathname: string): boolean {
  return DISABLED_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export async function middleware(request: NextRequest) {
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
   * - `/api/*` (API 経路)
   * - `/_next/*` (Next.js 内部アセット)
   * - 拡張子付き静的アセット (favicon / public/ 配下)
   * - `manifest.webmanifest` / `robots.txt` / `sitemap.xml` / `.well-known/*`
   *   など、未認証でもアクセスされうるメタ系ルート
   *   (PWA install / SNS リンクプレビュー / クローラー)
   */
  matcher: [
    "/((?!login|auth|api|_next/static|_next/image|favicon\\.ico|manifest\\.webmanifest|robots\\.txt|sitemap\\.xml|\\.well-known/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|css|js|mjs|woff|woff2|ttf|otf|map|txt|xml|webmanifest)$).*)",
  ],
};
