/**
 * Supabase Server クライアント (auth-and-notifications spec, Issue #16)
 *
 * Server Component / Server Action / Route Handler から呼ばれる Supabase クライアントと、
 * 認証セッション取得ヘルパを提供する。
 *
 * 制約:
 * - `import "server-only"` を必ず付け、Client バンドルへの混入を防ぐ
 * - Next.js 16 の async `cookies()` に追従 (await `cookies()`)
 * - 環境変数未設定時は warn ログ + サインイン経路は throw、`getCurrentSession()` は null 返却 (Req 8.2)
 * - `USE_MOCK_DB=true` の場合は Supabase を呼ばずに固定 mock profile を返す (design.md D-4)
 *
 * 関連: design.md §「lib/supabase/server.ts」, requirements.md §1.3, §1.5, §1.6, §8.2
 */

import "server-only";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { repos } from "@/lib/repositories";
import { PLACEHOLDER_DEV_PROFILE_ID } from "@/lib/mock/seed";
import type { Profile } from "@/types/profile";

export interface CurrentSession {
  readonly userId: string;
  readonly email: string;
}

let _missingEnvWarned = false;

function readSupabaseEnv(): { url: string; anonKey: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    if (!_missingEnvWarned) {
      console.warn(
        "[auth] NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY is not set. Sign-in flow will fail until these are configured.",
      );
      _missingEnvWarned = true;
    }
    return null;
  }
  return { url, anonKey };
}

function isMockMode(): boolean {
  return process.env.USE_MOCK_DB === "true";
}

/**
 * Server-side Supabase クライアントを生成する。
 *
 * Next.js 16 の async `cookies()` を await したうえで `getAll` / `setAll` の
 * cookies adapter を構築する。RSC からの `setAll` 呼び出しは `set` が許可
 * されない局面で例外が出るため try/catch で握り潰し、Server Action /
 * Route Handler 側で更新される設計に倣う。
 *
 * Mock モードでは throw する (本関数は通常モードでのみ呼ばれる想定。
 * `getCurrentSession` / `getCurrentProfile` が Mock モード時は早期 return する)。
 */
export async function getSupabaseServerClient(): Promise<SupabaseClient> {
  if (isMockMode()) {
    throw new Error(
      "[auth] getSupabaseServerClient() should not be called in mock mode (USE_MOCK_DB=true). Use getCurrentSession()/getCurrentProfile() instead.",
    );
  }
  const env = readSupabaseEnv();
  if (!env) {
    throw new Error(
      "[auth] Supabase environment variables are not set. Cannot create server client.",
    );
  }
  const cookieStore = await cookies();
  return createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // RSC からは cookie 更新できないが、Server Action / Route Handler から
          // 更新される設計のため、ここでは握り潰す。
        }
      },
    },
  });
}

/**
 * 現在のセッション (認証済ユーザー) を取得する。未認証なら null。
 *
 * Mock モード時は固定 `PLACEHOLDER_DEV_PROFILE_ID` を持つ偽セッションを返す
 * (design.md D-4)。
 */
export async function getCurrentSession(): Promise<CurrentSession | null> {
  if (isMockMode()) {
    const profile = await repos.profile.findById(PLACEHOLDER_DEV_PROFILE_ID);
    if (!profile) return null;
    return { userId: profile.id, email: profile.email };
  }
  const env = readSupabaseEnv();
  if (!env) return null;
  try {
    const supabase = await getSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;
    return {
      userId: data.user.id,
      email: data.user.email ?? "",
    };
  } catch (err) {
    console.error("[auth] getCurrentSession failed:", err);
    return null;
  }
}

/**
 * 現在のセッションに紐付く profile を取得する。
 *
 * Postgres trigger (`handle_new_user`) により `auth.users` への INSERT 時に
 * `profiles` レコードは自動生成されるため、認証済セッションが存在すれば
 * profile も存在することが保証される (Req 2.1)。万一存在しない場合は null。
 */
export async function getCurrentProfile(): Promise<Profile | null> {
  const session = await getCurrentSession();
  if (!session) return null;
  return repos.profile.findById(session.userId);
}
