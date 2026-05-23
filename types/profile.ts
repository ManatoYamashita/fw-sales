/**
 * ユーザープロフィール型 (auth-and-notifications spec, Issue #16)
 *
 * `auth.users` への INSERT を Postgres trigger (handle_new_user) でフックして
 * `profiles` テーブルへ自動展開された 1 レコードと 1:1 対応する。
 *
 * - `id` は `auth.users.id` への uuid FK (ON DELETE CASCADE)
 * - `email` は UNIQUE 制約付き、placeholder の場合は `placeholder-{slug}@local.invalid`
 * - `created_at` / `updated_at` は `YYYY-MM-DD` 形式 text を継続使用 (既存規約)
 */

/**
 * プロフィールロール。
 *
 * - `member`      : Google OAuth でサインインした実ユーザー (既定値)
 * - `placeholder` : バックフィル時に旧 text 担当者値から自動生成された暫定プロフィール。
 *                   メール送信時は `@local.invalid` ガードで no-op となる。
 * - `admin`       : 管理者ユーザー (deep-research-pipeline spec #43 で追加)。
 *                   月次予算警告通知 (`deep_research_budget_warning`) の fan-out 先。
 */
export type ProfileRole = "member" | "placeholder" | "admin";

export interface Profile {
  readonly id: string;
  readonly email: string;
  readonly display_name: string;
  readonly avatar_url: string | null;
  readonly role: ProfileRole;
  readonly created_at: string;
  readonly updated_at: string;
}

/**
 * プロフィール作成時の入力型 (本仕様でアプリ側からの作成は placeholder のみ)。
 * 通常の `member` プロフィールは Postgres trigger 経由で自動生成される。
 */
export type ProfileInput = Omit<Profile, "created_at" | "updated_at">;

/**
 * バックフィル用 placeholder プロフィール作成入力。
 * `slug` は `[a-z0-9-]+` の slugify 結果を渡す。
 */
export interface PlaceholderProfileInput {
  readonly displayName: string;
  readonly slug: string;
}
