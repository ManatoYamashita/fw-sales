/**
 * ユーザープロフィール型 (auth-and-notifications spec, Issue #16)
 *
 * `auth.users` への INSERT を Postgres trigger (handle_new_user) でフックして
 * `profiles` テーブルへ自動展開された 1 レコードと 1:1 対応する。
 *
 * - `id` は `auth.users.id` への uuid FK (ON DELETE CASCADE)
 * - `email` は UNIQUE 制約付き
 * - `created_at` / `updated_at` は `YYYY-MM-DD` 形式 text を継続使用 (既存規約)
 * - ロールは人ではなく所属 (テナント × ユーザー) の属性なので、`Profile` には持たせない。
 *   ロールが要る場面では `Member` を使う (マルチテナント化 #365 / #367)
 */

/**
 * 所属ロール。`memberships.role` に保存する。
 *
 * - `member`      : 通常のユーザー (既定値)
 * - `placeholder` : 旧 text 担当者値から作られた暫定プロフィールの所属。
 *                   メール送信時は `@local.invalid` ガードで no-op となる。
 * - `admin`       : 管理者。破壊的操作の認可 (#155) と設定画面の
 *                   ユーザー管理 UI (#157) で参照される。
 */
export type ProfileRole = "member" | "placeholder" | "admin";

/** 人 (アカウント) の情報。どのテナントに属しても変わらない。 */
export interface Profile {
  readonly id: string;
  readonly email: string;
  readonly display_name: string;
  readonly avatar_url: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

/**
 * あるテナントに所属しているユーザー。`role` はそのテナントでのロール
 * (`memberships.role`)。`profiles.role` は読まない (#376 で撤去する)。
 */
export interface Member extends Profile {
  readonly role: ProfileRole;
}
