/**
 * ProfileRepository interface (auth-and-notifications spec, Issue #16)
 *
 * `profiles` テーブルへの読み取り API と、バックフィル用 placeholder プロフィール
 * 作成 API を集約する境界層 interface。`auth.users` への INSERT 時の自動展開
 * (`handle_new_user` trigger) は **DB 側で完結**するため、本 interface に
 * member プロフィール作成 API は置かない (design.md §ProfileRepository)。
 *
 * 制約:
 * - 公開メソッドは読み取り 5 種 + placeholder 作成 1 種のみ
 * - `createPlaceholder` は `slug` から `placeholder-{slug}@local.invalid` 形式の
 *   email を組み立てる責務を持つ。生成された Profile は `role: 'placeholder'`
 *   を invariant として満たす
 *
 * 関連: design.md §「ProfileRepository」, requirements.md §2.1, §2.5, §3.4, §3.5, §3.7
 */

import type {
  PlaceholderProfileInput,
  Profile,
  ProfileRole,
} from "@/types/profile";

export interface ProfileRepository {
  findById(id: string): Promise<Profile | null>;
  findByEmail(email: string): Promise<Profile | null>;
  findByDisplayName(name: string): Promise<Profile | null>;
  findManyByIds(ids: readonly string[]): Promise<readonly Profile[]>;
  findAll(options?: {
    readonly excludePlaceholders?: boolean;
  }): Promise<readonly Profile[]>;
  /**
   * 管理者ロールのプロフィール一覧を返す (deep-research-pipeline spec #43)。
   * 月次予算警告通知の fan-out 先解決で使用する。
   */
  findAdmins(): Promise<readonly Profile[]>;
  /**
   * バックフィル用途のみ。member プロフィールは `auth.users` への INSERT を
   * フックする Postgres trigger 経由で生成される。
   *
   * @returns 生成された Profile (`role: 'placeholder'` 保証)
   */
  createPlaceholder(input: PlaceholderProfileInput): Promise<Profile>;
  /**
   * 指定ユーザーの role を更新し、更新後の Profile を返す (#155 ユーザー管理)。
   * 対象が存在しなければ null。認可 (admin 限定) や最後の管理者保護は
   * 呼び出し側 (Server Action) の責務であり、本メソッドは純粋な UPDATE のみを行う。
   */
  updateRole(id: string, role: ProfileRole): Promise<Profile | null>;
}
