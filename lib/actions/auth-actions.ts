/**
 * 認証関連 Server Actions (auth-and-notifications spec, Issue #16)
 *
 * 現状はサインアウトのみ。プロフィール更新等はスコープ外 (本仕様 OUT)。
 *
 * 関連: design.md §「lib/actions/auth-actions.ts」, requirements.md §1.6
 */

"use server";

import { failure, success, type ActionResult } from "./_helpers";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export interface SignOutResult {
  readonly redirectTo: string;
}

/**
 * 現在のセッションを破棄し、`/login` への遷移先を返す。
 *
 * - `USE_MOCK_DB=true` のときは `getSupabaseServerClient()` が throw するため
 *   try/catch で握り潰し、Mock 経路でも UX を阻害しない (常に成功扱い)
 * - 本番モードで失敗した場合のみ `failure(...)` を返し、UI 側でメッセージ表示
 */
export async function signOutAction(): Promise<ActionResult<SignOutResult>> {
  if (process.env.USE_MOCK_DB === "true") {
    return success({ redirectTo: "/login" });
  }
  try {
    const supabase = await getSupabaseServerClient();
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error("[auth] signOut failed:", error);
      return failure(
        "サインアウトに失敗しました。時間を置いて再試行してください。",
      );
    }
    return success({ redirectTo: "/login" });
  } catch (err) {
    console.error("[auth] signOut unexpected error:", err);
    return failure("サインアウト中に予期しないエラーが発生しました。");
  }
}
