/**
 * 担当者ドメイン定数 (Phase 7 でアプリ層が profiles テーブルへ完全移行済)。
 *
 * - `PLANNERS` / `SALES` / `CURRENT_USER` は Phase 7 で **撤廃**。
 *   担当者選択肢は `getAllProfiles()` (lib/queries/profiles.ts) から取得し、
 *   現在ログイン中ユーザは `getCurrentProfile()` (lib/supabase/server.ts) を使う。
 * - `OPS_MEMBERS` は `handoffs.ops_assignee` が text 列のまま暫定維持されているため、
 *   handoff 関連の user 参照化 (別 Issue) が完了するまで残置。
 */

export const OPS_MEMBERS = ["小泉", "山本"] as const;

export type OpsMember = (typeof OPS_MEMBERS)[number];
