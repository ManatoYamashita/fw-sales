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
 * 失敗した場合は `failure(...)` を返し、UI 側でメッセージ表示する。
 */
export async function signOutAction(): Promise<ActionResult<SignOutResult>> {
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
