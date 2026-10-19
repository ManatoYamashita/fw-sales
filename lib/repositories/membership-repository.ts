/**
 * MembershipRepository interface (マルチテナント化 #365 / #367)
 *
 * あるテナントに所属するユーザーと、そのテナントでのロールを扱う境界層 interface。
 * ロールの正は `memberships.role`。`profiles.role` は読み書きしない (#376 で撤去する)。
 *
 * - どのメソッドもテナント ID を引数に取り、そのテナントの所属だけを扱う
 * - 所属の無いユーザーは存在しないものとして扱う (`find` は null、`list` には出ない)
 */
import type { Member, ProfileRole } from "@/types/profile";

export interface MembershipRepository {
  /** テナントに所属するユーザーを返す。所属が無ければ null。 */
  find(tenantId: string, userId: string): Promise<Member | null>;
  /**
   * テナントの所属者の一覧。
   *
   * @param options.excludePlaceholders true なら placeholder の所属を除く (ユーザー管理 UI 用)
   */
  list(
    tenantId: string,
    options?: { readonly excludePlaceholders?: boolean },
  ): Promise<readonly Member[]>;
  /** テナントの admin の数。設定画面の「最後の管理者は降格できない」(#155) に使う。 */
  countAdmins(tenantId: string): Promise<number>;
  /**
   * テナントでのロールを更新し、更新後の所属を返す。所属が無ければ null。
   * 認可 (admin 限定) と最後の管理者保護は呼び出し側 (Server Action) の責務。
   */
  updateRole(tenantId: string, userId: string, role: ProfileRole): Promise<Member | null>;
}
