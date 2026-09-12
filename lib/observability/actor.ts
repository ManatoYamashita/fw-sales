import "server-only";
import type { Profile } from "@/types/profile";
import type { ActorSnapshot } from "./events";

/** Call only with the profile returned by a server-side authentication guard. */
export function snapshotActor(profile: Profile): ActorSnapshot {
  return { userId: profile.id, email: profile.email };
}
