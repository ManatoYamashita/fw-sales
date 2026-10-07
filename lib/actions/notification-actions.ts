"use server";

/**
 * 通知の既読化 Server Actions (#296)。
 *
 * 通知ベルから呼ばれ、ログイン中ユーザー本人の通知だけを既読にする。
 * 対象ユーザーはクライアントから受け取らず、必ずセッションの profile から決める
 * (他人の通知を既読化させない / Req 7.3 invariants)。
 *
 * キャッシュ: `getRecentNotifications` は `CACHE_TAGS.notifications` でキャッシュ
 * されるため、更新が発生したときだけ `updateTag` で失効させる (read-your-own-writes)。
 */

import { updateTag } from "next/cache";
import { repos } from "@/lib/repositories";
import { CACHE_TAGS } from "@/lib/cache";
import { getCurrentProfile } from "@/lib/supabase/server";
import { failure, success, type ActionResult } from "./_helpers";

const UNAUTHENTICATED_MESSAGE = "ログインが必要です";

/**
 * 指定通知を既読にする。既に既読・他人の通知・存在しない ID は何もしない
 * (クリックのたびに呼ばれるため、失敗扱いにせず `updated: false` を返す)。
 */
export async function markNotificationReadAction(
  notificationId: string,
): Promise<ActionResult<{ updated: boolean }>> {
  const profile = await getCurrentProfile();
  if (!profile) return failure(UNAUTHENTICATED_MESSAGE);
  if (typeof notificationId !== "string" || notificationId.trim() === "") {
    return failure("通知が指定されていません");
  }

  try {
    const updated = await repos.notification.markAsRead(
      notificationId,
      profile.id,
    );
    if (updated) {
      updateTag(CACHE_TAGS.notifications);
      updateTag(CACHE_TAGS.notification(notificationId));
    }
    return success({ updated });
  } catch (error) {
    console.error("[notifications.markAsRead] failed", {
      notificationId,
      userId: profile.id,
      error,
    });
    return failure("通知を既読にできませんでした");
  }
}

/** ログイン中ユーザー宛の未読通知をすべて既読にする。 */
export async function markAllNotificationsReadAction(): Promise<
  ActionResult<{ count: number }>
> {
  const profile = await getCurrentProfile();
  if (!profile) return failure(UNAUTHENTICATED_MESSAGE);

  try {
    const count = await repos.notification.markAllAsRead(profile.id);
    if (count > 0) updateTag(CACHE_TAGS.notifications);
    return success({ count });
  } catch (error) {
    console.error("[notifications.markAllAsRead] failed", {
      userId: profile.id,
      error,
    });
    return failure("通知を既読にできませんでした");
  }
}
