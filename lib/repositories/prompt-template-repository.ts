/**
 * PromptTemplateRepository interface (Issue #42)
 *
 * `ai_prompt_templates` テーブルへのアクセス契約。
 *
 * 設計上の不変条件:
 * - 取得・更新・削除系のすべてのメソッドで `userId` 条件を必ず含める。
 *   他ユーザーのテンプレートを参照・変更できないよう、repository 層でも防御する。
 * - `setDefault` は 2 ステップ (clearDefault → update) で構成される。
 *   原子性が必要な場合は呼び出し側が `repos.transaction()` で包むこと。
 * - デフォルトテンプレートの削除拒否は DB trigger (migration 0009) で保証。
 *   Server Action 側でも二重ガードを行う (Phase 2 実装予定)。
 *
 * 関連: Issue #42, lib/db/prompt-template-repository.ts
 */

import type {
  AiPromptTemplate,
  AiPromptTemplateInput,
} from "@/types/ai-prompt-template";

export interface PromptTemplateRepository {
  /** 指定ユーザーのテンプレートを全件返す (作成日時 DESC)。 */
  list(userId: string): Promise<AiPromptTemplate[]>;

  /**
   * id + userId で 1 件取得。
   * 他ユーザーのテンプレートは null を返す (userId 条件で防御)。
   */
  findById(id: string, userId: string): Promise<AiPromptTemplate | null>;

  /** テンプレートを新規挿入する。id / created_at / updated_at は実装側で生成。 */
  insert(
    input: AiPromptTemplateInput & { user_id: string },
  ): Promise<AiPromptTemplate>;

  /**
   * id + userId で 1 件更新。
   * 対象が存在しない / 他ユーザーのテンプレートの場合は null を返す。
   */
  update(
    id: string,
    userId: string,
    patch: Partial<AiPromptTemplateInput>,
  ): Promise<AiPromptTemplate | null>;

  /**
   * id + userId で 1 件削除。
   * 削除できた場合は true、対象が存在しない / 他ユーザーの場合は false。
   * デフォルトテンプレートの削除は DB trigger で拒否される (migration 0009)。
   */
  delete(id: string, userId: string): Promise<boolean>;

  /** 指定ユーザーが保持するテンプレートの件数を返す (最大 5 件制約の判定用)。 */
  countByUser(userId: string): Promise<number>;

  /**
   * 指定ユーザーの全テンプレートの is_default を false に更新する。
   * `setDefault` の Step 1 として単独でも利用可能。
   */
  clearDefaultForUser(userId: string): Promise<void>;

  /**
   * 指定 id のテンプレートをデフォルトに設定する。
   * 内部で clearDefaultForUser → update(is_default: true) を実行する。
   * 原子性が必要な場合は呼び出し側が `repos.transaction()` で包むこと。
   * 対象が存在しない / 他ユーザーの場合は null を返す。
   */
  setDefault(id: string, userId: string): Promise<AiPromptTemplate | null>;
}
