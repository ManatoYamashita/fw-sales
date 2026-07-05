/**
 * 認証関連 Server Actions (auth-and-notifications spec, Issue #16)
 *
 * 現状はサインアウトのみ。プロフィール更新等はスコープ外 (本仕様 OUT)。
 *
 * 関連: design.md §「lib/actions/auth-actions.ts」, requirements.md §1.6
 */

"use server";

import { failure, success, type ActionResult } from "./_helpers";
import { getCurrentProfile, getSupabaseServerClient } from "@/lib/supabase/server";
import type { ProfileRole } from "@/types/profile";

export interface SignOutResult {
  readonly redirectTo: string;
}

export interface SessionRole {
  readonly role: ProfileRole;
  readonly isAdmin: boolean;
}

/**
 * 現在のセッションのロールを返す読み取り系 Server Action (#155)。
 *
 * Client Component (CurrentUserProvider) が hydration 後に 1 回だけ呼び、
 * 破壊的操作ボタンの無効化に使う。cookies() を読むが Server Action は
 * post-hydration の POST であり、(main) ページの静的 PPR シェルには影響しない
 * (page 本体で cookies() を読まないことで #106/#107 の build 崩壊を回避する設計)。
 *
 * 認可の真の防御は各 action の requireAdmin ガードであり、本 action の値は
 * UI 表示上の補助に過ぎない。
 */
export async function getSessionRoleAction(): Promise<ActionResult<SessionRole>> {
  const profile = await getCurrentProfile();
  if (!profile) return failure("未認証");
  return success({ role: profile.role, isAdmin: profile.role === "admin" });
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
