import "server-only";

import { getCurrentProfile } from "@/lib/supabase/server";
import { failure, type ActionResult } from "./_helpers";
import type { Profile } from "@/types/profile";

/**
 * 破壊的 Server Action の認可ガード (#155 destructive-action-authz)。
 *
 * `prompt-template-actions.ts` などの inline session チェックを一般化し、
 * 「admin ロールのみ破壊的操作を許可する」規約を単一の窓口に集約する。
 *
 * 設計:
 * - ActionResult フローに早期 return で合成できる判別式 union を返す
 *   (`if (!guard.ok) return guard.denied;`)。許可時は成功監査ログ用に profile を返す。
 * - 拒否理由 (未認証 / 権限不足) と識別子 (userId / email / role) は構造化ログ
 *   (`console.warn("[authz] denied", …)`) にのみ残し、UI へ返す文言には
 *   内部情報を一切含めない (#152 で確立した二系統設計を踏襲)。
 * - 認可の唯一の真の防御はこのサーバ層。UI 側のボタン無効化は UX 上の補助に過ぎない。
 *
 * 適用範囲は破壊的 8 action (store/deal/handoff の delete、data の reset/clear/import、
 * prompt-template の delete)。非破壊 WRITE や READ には適用しない。
 */
export type AdminGuard =
  | { ok: true; profile: Profile }
  | { ok: false; denied: ActionResult<never> };

/**
 * 呼び出し元がログイン済みであることを要求する (非破壊 WRITE 用の最小ガード)。
 * `requireAdmin` と異なりロールは問わない。middleware による保護に加え、
 * Server Action 単体でも認証チェックする多層防御として各 action の先頭で呼ぶ。
 */
export async function requireSignedIn(): Promise<ActionResult<never> | null> {
  return (await getCurrentProfile()) ? null : failure("ログインが必要です");
}

/**
 * 呼び出し元が admin ロールであることを要求する。
 *
 * @param action 監査ログ用のアクション識別子 (既存ログ prefix と統一。例: "stores.delete")
 * @returns 許可時 `{ ok: true, profile }` / 拒否時 `{ ok: false, denied }`(UI 返却用 failure)
 */
export async function requireAdmin(action: string): Promise<AdminGuard> {
  const profile = await getCurrentProfile();
  if (!profile) {
    console.warn("[authz] denied", { action, reason: "unauthenticated" });
    return { ok: false, denied: failure("ログインが必要です") };
  }
  if (profile.role !== "admin") {
    console.warn("[authz] denied", {
      action,
      userId: profile.id,
      email: profile.email,
      role: profile.role,
      reason: "not_admin",
    });
    return {
      ok: false,
      denied: failure("この操作には管理者権限が必要です"),
    };
  }
  return { ok: true, profile };
}
