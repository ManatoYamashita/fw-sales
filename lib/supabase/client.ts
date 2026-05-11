/**
 * Supabase Browser クライアント (auth-and-notifications spec, Issue #16)
 *
 * Client Component から呼ばれる Supabase クライアント。主用途は
 * `signInWithOAuth({ provider: 'google' })` の起動 (Req 1.2)。
 *
 * 制約:
 * - singleton として 1 度だけ生成し、複数の Client Component から再利用する
 * - 環境変数未設定時は warn ログ + throw (UI 側でエラーをキャッチして表示する)
 * - Mock モードでは UI 側で本関数を呼ばない設計 (`/login` UI は本番モード専用)
 *
 * 関連: design.md §「lib/supabase/client.ts」, requirements.md §1.2
 */

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

export function getSupabaseBrowserClient(): SupabaseClient {
  if (_client) return _client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    console.warn(
      "[auth] NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY is not set. Browser client cannot be created.",
    );
    throw new Error(
      "Supabase environment variables are not set. Sign-in is unavailable.",
    );
  }

  _client = createBrowserClient(url, anonKey);
  return _client;
}
