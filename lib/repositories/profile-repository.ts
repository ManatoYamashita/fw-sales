/**
 * ProfileRepository interface (auth-and-notifications spec, Issue #16)
 *
 * `profiles` テーブル (人の情報) への読み取り API を集約する境界層 interface。
 * `auth.users` への INSERT 時の自動展開 (`handle_new_user` trigger) は **DB 側で完結**するため、
 * 本 interface にプロフィール作成 API は置かない (design.md §ProfileRepository)。
 *
 * ロールは人ではなく所属の属性なので、ここでは扱わない。ロールの読み書きは
 * `MembershipRepository` を使う (マルチテナント化 #367)。
 *
 * 関連: design.md §「ProfileRepository」, requirements.md §2.1, §2.5, §3.4, §3.5, §3.7
 */

import type { Profile } from "@/types/profile";

export interface ProfileRepository {
  findById(id: string): Promise<Profile | null>;
  findByEmail(email: string): Promise<Profile | null>;
  findByDisplayName(name: string): Promise<Profile | null>;
  findManyByIds(ids: readonly string[]): Promise<readonly Profile[]>;
  findAll(): Promise<readonly Profile[]>;
}
