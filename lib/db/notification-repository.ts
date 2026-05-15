/**
 * NotificationRepository の Drizzle 実装 (auth-and-notifications spec, Issue #16)
 *
 * `lib/repositories/notification-repository.ts` の interface を Drizzle で 1:1 実装。
 *
 * 制約:
 * - `import "server-only"` を必ず付ける
 * - `markAsRead` は `WHERE id = ? AND user_id = ?` で他人の既読化を防ぐ (Req 7.3 invariants)
 * - id は `notif_<id>` 形式を採用 (既存 `<entity>_<id>` 規約)
 *
 * 関連: design.md §「NotificationRepository」, requirements.md §7.1, §7.2, §7.3
 */

import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, type DbClient, type Tx } from "./client";
import { notifications } from "./schema";
import type { NotificationRepository } from "@/lib/repositories/notification-repository";
import type {
  Notification,
  NotificationInput,
  NotificationKind,
} from "@/types/notification";
import { generateId } from "@/lib/utils/id";
import { today } from "@/lib/utils/date";

type NotificationSelectRow = typeof notifications.$inferSelect;

/**
 * 想定外の `kind` 値が DB から来た場合は `research_job_failed` 扱いにフェイルセーフ。
 * 将来 `NotificationKind` を拡張する際にここを更新。
 */
function asNotificationKind(raw: string): NotificationKind {
  if (raw === "research_job_completed" || raw === "research_job_failed") {
    return raw;
  }
  return "research_job_failed";
}

function fromDbRow(row: NotificationSelectRow): Notification {
  return {
    id: row.id,
    user_id: row.user_id,
    kind: asNotificationKind(row.kind),
    title: row.title,
    body: row.body,
    link_url: row.link_url,
    read_at: row.read_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function makeNotificationRepo(
  executor: DbClient | Tx,
): NotificationRepository {
  return {
    async findByUserId(userId, options = {}) {
      const conditions = [eq(notifications.user_id, userId)];
      if (options.unreadOnly) {
        conditions.push(isNull(notifications.read_at));
      }
      const rows = await executor
        .select()
        .from(notifications)
        .where(and(...conditions))
        .orderBy(desc(notifications.created_at));
      return rows.map(fromDbRow);
    },

    async markAsRead(notificationId, userId) {
      const result = await executor
        .update(notifications)
        .set({ read_at: today(), updated_at: today() })
        .where(
          and(
            eq(notifications.id, notificationId),
            eq(notifications.user_id, userId),
          ),
        )
        .returning({ id: notifications.id });
      return result.length > 0;
    },

    async insert(input: NotificationInput) {
      const now = today();
      const row: Notification = {
        ...input,
        id: generateId("notif"),
        read_at: null,
        created_at: now,
        updated_at: now,
      };
      await executor.insert(notifications).values(row);
      return row;
    },
  };
}

export const dbNotificationRepo: NotificationRepository =
  makeNotificationRepo(db);
