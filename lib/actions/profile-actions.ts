"use server";

/**
 * プロフィール (ユーザー) 管理 Server Actions (#155 ユーザー管理)。
 *
 * admin が設定画面から他ユーザーの role を変更するための write API。
 * profile の変更系はこれが初出 (従来 repo は read + placeholder 作成のみ)。
 *
 * 設計:
 * - 認可は `requireAdmin` に集約 (#155)。拒否理由は構造化ログ、UI 文言は内部情報を出さない。
 * - **最後の管理者保護**: admin が 1 人だけのときにその admin を降格する経路を拒否し、
 *   全員 member でロックアウトする事故を防ぐ。
 * - キャッシュ: profiles は従来 invalidate 呼び出しゼロ。本 action で
 *   `updateTag(CACHE_TAGS.profiles)` + 個別タグを必ず失効させ、呼び出し側の
 *   `router.refresh()` と併せて最新化する (settings CRUD の updateTag 規約に準拠)。
 */

import { updateTag } from "next/cache";
import { repos } from "@/lib/repositories";
import { CACHE_TAGS } from "@/lib/cache";
import { failure, success, type ActionResult } from "./_helpers";
import { requireAdmin } from "./_authz";
import type { Profile, ProfileRole } from "@/types/profile";

/** UI から変更可能な role。placeholder はバックフィル生成物のため対象外。 */
const ASSIGNABLE_ROLES: readonly ProfileRole[] = ["member", "admin"];

/**
 * 指定ユーザーの role を変更する (admin 限定)。
 *
 * @param userId 対象ユーザーの profile id
 * @param role 新しい role ("member" | "admin" のみ)
 */
export async function updateProfileRoleAction(
  userId: string,
  role: ProfileRole,
): Promise<ActionResult<Profile>> {
  const guard = await requireAdmin("profiles.updateRole");
  if (!guard.ok) return guard.denied;

  if (!ASSIGNABLE_ROLES.includes(role)) {
    return failure("指定できないロールです");
  }

  // 降格 (admin 以外へ) の場合のみ、最後の管理者を守る。
  if (role !== "admin") {
    const target = await repos.profile.findById(userId);
    if (!target) return failure("ユーザーが見つかりません");
    if (target.role === "admin") {
      const admins = await repos.profile.findAdmins();
      if (admins.length <= 1) {
        return failure("最後の管理者は降格できません");
      }
    }
  }

  const updated = await repos.profile.updateRole(userId, role);
  if (!updated) return failure("ユーザーが見つかりません");

  updateTag(CACHE_TAGS.profiles);
  updateTag(CACHE_TAGS.profile(userId));
  console.log("[audit] profiles.updateRole", {
    by: guard.profile.email,
    targetId: userId,
    targetEmail: updated.email,
    to: role,
  });
  return success(updated, "ロールを更新しました");
}
