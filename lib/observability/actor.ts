import "server-only";
import type { Profile } from "@/types/profile";
import type { CurrentSession } from "@/lib/supabase/server";
import type { ActorSnapshot } from "./events";

/** Call only with the profile returned by a server-side authentication guard. */
export function snapshotActor(profile: Profile): ActorSnapshot {
  return { userId: profile.id, email: profile.email };
}

/**
 * `getCurrentSession()` がサーバ側で確認したセッションから操作者を取る。
 * profile を読まない Action (AI 調査の起動・レビュー) 向け。クライアントが送った値は使わない。
 */
export function snapshotSessionActor(session: CurrentSession): ActorSnapshot {
  return { userId: session.userId, email: session.email };
}
