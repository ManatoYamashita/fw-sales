/**
 * Notification 関連の `'use cache'` クエリ (初出: deep-research-pipeline spec #43, Task 3.4)
 *
 * - `getRecentNotifications(userId, limit?)`: 当該ユーザー宛通知を新しい順で返す
 *
 * Topbar Bell (NotificationBell) の親 RSC が呼び、props で Client Component に
 * 渡す前提。
 *
 * 店舗詳細を指す `link_url` は、店舗が削除済みなら null に落としてから返す (#296)。
 * 店舗削除で結果が変わるため `CACHE_TAGS.stores` にも相乗りする。
 *
 * 注意: 現在この通知を発行する writer はアプリ内に存在しない
 * (`deep_research_*` の通知種別は #185 で撤去、`repos.notification` は
 * 読み取りのみ)。`revalidateTag(CACHE_TAGS.notifications)` による失効契約だけを
 * 維持しており、writer を足す際はそのタグを叩くこと。
 *
 * 関連: design.md §Components and Interfaces / NotificationBell,
 *       requirements.md §4.1, §4.2, §4.3
 */

import "server-only";

import { cacheLife, cacheTag } from "next/cache";
import { repos } from "@/lib/repositories";
import { CACHE_TAGS } from "@/lib/cache";
import { extractStoreIdFromLink } from "@/lib/domain/notification-link";
import type { Notification } from "@/types/notification";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

/**
 * 指定ユーザー宛の通知を新しい順に最大 `limit` 件返す。
 *
 * - `userId` が `null`/空文字: 空配列を返す (UI から呼ぶ際の guard)
 * - `limit` 未指定: 10 件、上限 50 件
 * - 既読/未読両方を含む (UI 側で `read_at` を見て表示分岐)
 * - 存在しない店舗を指す `link_url` は null にする (404 画面へ誘導しない)
 */
export async function getRecentNotifications(
  userId: string | null,
  limit: number = DEFAULT_LIMIT,
): Promise<readonly Notification[]> {
  "use cache";
  cacheLife("longBackstop");
  cacheTag(CACHE_TAGS.notifications, CACHE_TAGS.stores);

  if (!userId || userId.trim() === "") return [];
  const safeLimit = Math.min(Math.max(1, limit), MAX_LIMIT);

  const all = await repos.notification.findByUserId(userId);
  // findByUserId は created_at DESC で返すパターンを Mock/DB ともに踏襲済
  return dropDeadStoreLinks(all.slice(0, safeLimit));
}

async function dropDeadStoreLinks(
  notifications: readonly Notification[],
): Promise<readonly Notification[]> {
  const storeIds = new Set<string>();
  for (const n of notifications) {
    const id = extractStoreIdFromLink(n.link_url);
    if (id) storeIds.add(id);
  }
  if (storeIds.size === 0) return notifications;

  const existing = new Set<string>();
  await Promise.all(
    [...storeIds].map(async (id) => {
      if (await repos.store.get(id)) existing.add(id);
    }),
  );

  return notifications.map((n) => {
    const id = extractStoreIdFromLink(n.link_url);
    return id && !existing.has(id) ? { ...n, link_url: null } : n;
  });
}
