/**
 * Next.js Root Middleware (auth-and-notifications spec, Issue #16)
 *
 * `(main)` Route Group 配下の全リクエストでセッション検証を行い、未認証なら
 * `/login?redirect={pathname}` にリダイレクトする。
 *
 * 制約:
 * - Edge Runtime で動作する (`postgres` 直接接続は不可)
 * - matcher で `(main)` 配下のみ対象、`/login` / `/auth/*` / `/api/cron/*` /
 *   `/_next/*` / 静的アセット / favicon は除外
 * - 認証検証本体は `lib/supabase/middleware.ts:updateSession()` に委譲し、
 *   本ファイルはマッチパターンとリダイレクト発火に責務を絞る
 *
 * 関連: design.md §「middleware.ts」, requirements.md §1.1, §1.5
 */

import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  const { response, isAuthenticated } = await updateSession(request);

  if (!isAuthenticated) {
    const redirectUrl = new URL("/login", request.url);
    redirectUrl.searchParams.set("redirect", request.nextUrl.pathname);
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}

export const config = {
  /*
   * 保護対象は `(main)` Route Group 配下の全ページ。除外は次の通り:
   * - `/login` / `/auth/*` (認証経路自体)
   * - `/api/*` (API 経路、Cron は CRON_SECRET ヘッダで別途守る)
   * - `/_next/*` (Next.js 内部アセット)
   * - 拡張子付き静的アセット (favicon / public/ 配下)
   */
  matcher: [
    "/((?!login|auth|api|_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|css|js|woff|woff2|ttf|otf|map)$).*)",
  ],
};
