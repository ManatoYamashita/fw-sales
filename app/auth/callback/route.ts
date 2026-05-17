/**
 * OAuth コールバック Route Handler (auth-and-notifications spec, Issue #16)
 *
 * Google 同意完了後に Supabase が `?code=xxx&redirect=/dashboard` のような形で
 * 本ルートにリダイレクトしてくる。`exchangeCodeForSession(code)` でセッションを
 * 確立し、cookie を更新したうえで `redirect` クエリの URL に戻す。
 *
 * 制約:
 * - `code` クエリ欠落 / 不正は `/login?error=callback_invalid` に戻す
 * - `exchangeCodeForSession` 失敗は `/login?error=oauth_failed` に戻す
 * - `redirect` クエリは "/" 始まりの相対パスのみ許可 (open redirect 防止)
 * - 成功時は `redirect` (なければ `/dashboard`) へ 302
 *
 * 関連: design.md §「app/auth/callback」, requirements.md §1.3, §1.4, §2.1
 */

import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

function safeRedirect(value: string | null): string {
  if (!value) return "/stores";
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  return "/stores";
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const redirectTo = safeRedirect(searchParams.get("redirect"));

  if (!code) {
    const url = new URL("/login", origin);
    url.searchParams.set("error", "callback_invalid");
    return NextResponse.redirect(url);
  }

  try {
    const supabase = await getSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.error("[auth] OAuth callback exchangeCodeForSession failed:", error);
      const url = new URL("/login", origin);
      url.searchParams.set("error", "oauth_failed");
      return NextResponse.redirect(url);
    }
    return NextResponse.redirect(new URL(redirectTo, origin));
  } catch (err) {
    console.error("[auth] OAuth callback unexpected failure:", err);
    const url = new URL("/login", origin);
    url.searchParams.set("error", "oauth_failed");
    return NextResponse.redirect(url);
  }
}
