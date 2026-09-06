/**
 * Supabase Proxy セッションヘルパ (auth-and-notifications spec, Issue #16)
 *
 * Next.js root proxy (`proxy.ts`) から呼ばれ、`@supabase/ssr` の
 * cookies adapter で `request.cookies` / `response.cookies` を橋渡しし、
 * セッション cookie の refresh と認証状態の判定を 1 関数で完結させる。
 *
 * 制約:
 * - Node.js runtime で動作する (Next.js 16 の proxy は runtime 固定)。ただし
 *   全リクエストの前段で走るため postgres 直接接続や重い依存は持ち込まない
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

/**
 * Supabase Auth API への fetch を強制中断する上限。
 *
 * 2026-06-21 の本番障害 (Supabase Free Tier の 7 日 pause → DNS NXDOMAIN →
 * `auth.getUser()` がハング → 504 GATEWAY_TIMEOUT) に対する fail-fast 防御
 * (PR #146 / Issue #147)。Supabase プロジェクトが pause / DNS NXDOMAIN /
 * 経路障害でハングした際にプラットフォームの実行上限まで待たず、`/login`
 * リダイレクトに fall through するため 4 秒で AbortSignal を発火させる。
 * 通常応答は数百ms に収まるため誤発火しない想定。
 *
 * 実行レイヤは Next.js 16 の proxy 化で Edge Middleware (総上限 25,000ms) から
 * Node.js function に変わった。上限値は `vercel.json` に `maxDuration` を
 * 指定していないため Vercel のデフォルトに依存するが、**外部 fetch がハングする
 * 構造自体は変わらない**ので、この防御は runtime を問わず必要。
 */
const AUTH_FETCH_TIMEOUT_MS = 4_000;
const E2E_SESSION_COOKIE = "__fw_e2e_session";

let _missingEnvWarned = false;

function isE2eMode(): boolean {
  return process.env.NODE_ENV === "development" && process.env.E2E_TEST_MODE === "1";
}

function isE2eAuthenticated(request: NextRequest): boolean {
  const configuredSecret = process.env.E2E_TEST_SECRET;
  return Boolean(
    configuredSecret &&
      process.env.E2E_TEST_USER_ID &&
      request.cookies.get(E2E_SESSION_COOKIE)?.value === configuredSecret,
  );
}

function readSupabaseEnv(): { url: string; anonKey: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    if (!_missingEnvWarned) {
      console.warn(
        "[auth] NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY is not set. Proxy will treat all requests as unauthenticated.",
      );
      _missingEnvWarned = true;
    }
    return null;
  }
  return { url, anonKey };
}

/**
 * proxy (Node.js runtime) 上で実行されるセッション更新ヘルパ。
 *
 * - cookies の `getAll` / `setAll` で Supabase 側に refresh を任せ、
 *   `auth.getUser()` でセッション検証する
 * - 認証未設定 / 失敗時は `isAuthenticated: false` を返し、呼び出し側 (proxy.ts)
 *   で `/login` リダイレクトを発火させる
 */
export async function updateSession(
  request: NextRequest,
): Promise<UpdateSessionResult> {
  if (isE2eMode()) {
    const isAuthenticated = isE2eAuthenticated(request);
    return {
      response: NextResponse.next({ request }),
      isAuthenticated,
      userId: isAuthenticated ? process.env.E2E_TEST_USER_ID ?? null : null,
    };
  }

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
    global: {
      // signal は `...init` の後に置くと将来 supabase-js が `init.signal` を渡し
      // 始めた際に黙ってクロバーされるため、`AbortSignal.any` で合成する。
      // (Node 20 / Edge runtime 両対応)
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        fetch(input, {
          ...init,
          signal: init?.signal
            ? AbortSignal.any([
                init.signal,
                AbortSignal.timeout(AUTH_FETCH_TIMEOUT_MS),
              ])
            : AbortSignal.timeout(AUTH_FETCH_TIMEOUT_MS),
        }),
    },
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
      // auth-js は fetch 失敗 (timeout / DNS / network) を `AuthRetryableFetchError`
      // に wrap して error として return する (throw しない)。よって本番で起きる
      // Supabase 障害はこの分岐で警告し可視化する。`!user` のみで error が null の
      // 通常の未認証ケース (cookie 不在等) は静かに fall through する。
      if (error?.name === "AuthRetryableFetchError") {
        console.warn(
          `[auth] Supabase auth.getUser() failed (likely ${AUTH_FETCH_TIMEOUT_MS}ms timeout or network) — falling through as unauthenticated:`,
          error.message,
        );
      }
      return { response, isAuthenticated: false, userId: null };
    }
    return { response, isAuthenticated: true, userId: user.id };
  } catch (err) {
    // 防御コード (theoretical) — auth-js が error を return するため通常は到達しない。
    // 安全網として残置。
    console.error("[auth] proxy updateSession failed:", err);
    return { response, isAuthenticated: false, userId: null };
  }
}
