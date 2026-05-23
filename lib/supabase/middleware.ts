/**
 * Supabase Middleware セッションヘルパ (auth-and-notifications spec, Issue #16)
 *
 * Next.js root middleware (`middleware.ts`) から呼ばれ、`@supabase/ssr` の
 * cookies adapter で `request.cookies` / `response.cookies` を橋渡しし、
 * セッション cookie の refresh と認証状態の判定を 1 関数で完結させる。
 *
 * 制約:
 * - Edge Runtime で動作する (postgres 直接接続不可)
 * - `import "server-only"` を必ず付ける
 * - 認証関連の環境変数未設定時は warn ログ + `isAuthenticated: false` を返却
 *
 * 関連: design.md §「lib/supabase/middleware.ts」, requirements.md §1.1, §8.2
 */

import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

export interface UpdateSessionResult {
  readonly response: NextResponse;
  readonly isAuthenticated: boolean;
  readonly userId: string | null;
}

let _missingEnvWarned = false;

function readSupabaseEnv(): { url: string; anonKey: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    if (!_missingEnvWarned) {
      console.warn(
        "[auth] NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY is not set. Middleware will treat all requests as unauthenticated.",
      );
      _missingEnvWarned = true;
    }
    return null;
  }
  return { url, anonKey };
}

/**
 * Edge Runtime 上で実行されるセッション更新ヘルパ。
 *
 * - cookies の `getAll` / `setAll` で Supabase 側に refresh を任せ、
 *   `auth.getUser()` でセッション検証する
 * - 認証未設定 / 失敗時は `isAuthenticated: false` を返し、呼び出し側 (middleware.ts)
 *   で `/login` リダイレクトを発火させる
 */
export async function updateSession(
  request: NextRequest,
): Promise<UpdateSessionResult> {
  const env = readSupabaseEnv();
  if (!env) {
    return {
      response: NextResponse.next({ request }),
      isAuthenticated: false,
      userId: null,
    };
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(
        cookiesToSet: { name: string; value: string; options: CookieOptions }[],
      ) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    if (error || !user) {
      return { response, isAuthenticated: false, userId: null };
    }
    return { response, isAuthenticated: true, userId: user.id };
  } catch (err) {
    console.error("[auth] middleware updateSession failed:", err);
    return { response, isAuthenticated: false, userId: null };
  }
}
