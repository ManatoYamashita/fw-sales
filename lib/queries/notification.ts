/**
 * Notification 関連の `'use cache'` クエリ (deep-research-pipeline spec #43, Task 3.4)
 *
 * - `getRecentNotifications(userId, limit?)`: 当該ユーザー宛通知を新しい順で返す
 *
 * Topbar Bell (NotificationBell, Task 5.5) の親 RSC が呼び、props で
 * Client Component に渡す前提。`createDeepResearchNotification` (Task 3.3) 後の
 * `revalidateTag(CACHE_TAGS.notifications)` で SWR される。
 *
 * 関連: design.md §Components and Interfaces / NotificationBell,
 *       requirements.md §4.1, §4.2, §4.3
 */

import "server-only";

import { cacheLife, cacheTag } from "next/cache";
import { repos } from "@/lib/repositories";
import { CACHE_TAGS } from "@/lib/cache";
import type { Notification } from "@/types/notification";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

/**
 * 指定ユーザー宛の通知を新しい順に最大 `limit` 件返す。
 *
 * - `userId` が `null`/空文字: 空配列を返す (UI から呼ぶ際の guard)
 * - `limit` 未指定: 10 件、上限 50 件
 * - 既読/未読両方を含む (UI 側で `read_at` を見て表示分岐)
 */
export async function getRecentNotifications(
  userId: string | null,
  limit: number = DEFAULT_LIMIT,
): Promise<readonly Notification[]> {
  "use cache";
  cacheLife("longBackstop");
  cacheTag(CACHE_TAGS.notifications);

  if (!userId || userId.trim() === "") return [];
  const safeLimit = Math.min(Math.max(1, limit), MAX_LIMIT);

  const all = await repos.notification.findByUserId(userId);
  // findByUserId は created_at DESC で返すパターンを Mock/DB ともに踏襲済
  return all.slice(0, safeLimit);
}
