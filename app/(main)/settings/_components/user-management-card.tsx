import { getCurrentProfile } from "@/lib/supabase/server";
import { getAllProfiles } from "@/lib/queries/profiles";
import { UserManagementShell } from "./user-management-shell";

/**
 * ユーザー管理カードの server wrapper (#155)。
 *
 * - admin 以外には何も描画しない (非 admin にユーザー一覧を一切送らない server 側ゲート)。
 * - placeholder (バックフィル生成物) は一覧から除外。
 * - `getCurrentProfile()` が cookies を読むため、呼び出し側 (settings/page.tsx) で
 *   必ず <Suspense> 隔離し、静的 PPR シェルを保つこと (AiPromptTemplatesCard と同型)。
 */
export async function UserManagementCard() {
  const current = await getCurrentProfile();
  if (current?.role !== "admin") return null;

  const users = await getAllProfiles({ excludePlaceholders: true });
  return <UserManagementShell users={users} currentUserId={current.id} />;
}
