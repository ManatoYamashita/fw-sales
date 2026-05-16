/**
 * NotificationRepository の Mock 実装 (auth-and-notifications spec, Issue #16)
 *
 * `lib/mock/db.ts` の共有 `notifications` Map を背後ストアとし、
 * `USE_MOCK_DB=true` 時に `repos.notification` 経由で参照される。
 *
 * 制約:
 * - `import "server-only"` を必ず付ける
 * - `markAsRead` は `userId` 一致を必ず確認 (他人の既読化を禁止)
 * - id 形式は DB 実装と完全一致 (`generateId("notif")`)
 *
 * 関連: design.md §「NotificationRepository」, requirements.md §7.1, §7.2, §7.3
 */

import "server-only";
import type { NotificationRepository } from "@/lib/repositories/notification-repository";
import type {
  Notification,
  NotificationInput,
} from "@/types/notification";
import { mockDb } from "./db";
import { generateId } from "@/lib/utils/id";
import { today } from "@/lib/utils/date";

export const mockNotificationRepo: NotificationRepository = {
  async findByUserId(userId, options = {}) {
    const all = [...mockDb.notifications.values()].filter(
      (n) => n.user_id === userId,
    );
    const filtered = options.unreadOnly
      ? all.filter((n) => n.read_at === null)
      : all;
    return filtered.sort((a, b) =>
      a.created_at < b.created_at ? 1 : -1,
    );
  },

  async markAsRead(notificationId, userId) {
    const current = mockDb.notifications.get(notificationId);
    if (!current || current.user_id !== userId) return false;
    const next: Notification = {
      ...current,
      read_at: today(),
      updated_at: today(),
    };
    mockDb.notifications.set(notificationId, next);
    return true;
  },

  async insert(input: NotificationInput) {
    const now = today();
    const notification: Notification = {
      ...input,
      id: generateId("notif"),
      read_at: null,
      created_at: now,
      updated_at: now,
    };
    mockDb.notifications.set(notification.id, notification);
    return notification;
  },
};
