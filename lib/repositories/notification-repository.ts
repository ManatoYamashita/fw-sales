/**
 * NotificationRepository interface (auth-and-notifications spec, Issue #16)
 *
 * アプリ内通知の user_id ベース取得契約を提供する。テーブル本体と通知ベル UI は
 * 別仕様 (#14) が所有し、本仕様は user_id 絞り込み契約のみを担う
 * (design.md §Boundary Commitments)。
 *
 * 制約:
 * - `markAsRead` は `userId` 一致を必ず確認する (他人の既読化を禁止する invariants)
 * - `insert` は通知発生点 (#14 のジョブハンドラなど) から呼ばれ、user_id を
 *   特定したうえで挿入する責務 (Req 7.2)
 *
 * 関連: design.md §「NotificationRepository」, requirements.md §7.1, §7.2, §7.3
 */

import type { Notification, NotificationInput } from "@/types/notification";

export interface NotificationRepository {
  findByUserId(
    userId: string,
    options?: { readonly unreadOnly?: boolean },
  ): Promise<readonly Notification[]>;
  /**
   * 既読化。`userId` が当該通知の `user_id` と一致しない場合は何もしない。
   * 戻り値は更新が発生した場合 true。
   */
  markAsRead(notificationId: string, userId: string): Promise<boolean>;
  insert(input: NotificationInput): Promise<Notification>;
}
