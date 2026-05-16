/**
 * ProfileRepository の Mock 実装 (auth-and-notifications spec, Issue #16)
 *
 * `lib/mock/db.ts` の共有 `profiles` Map を背後ストアとし、`USE_MOCK_DB=true`
 * 時に `repos.profile` 経由で参照される。
 *
 * 制約:
 * - `import "server-only"` を必ず付ける
 * - `createPlaceholder` の email 形式は `placeholder-{slug}@local.invalid` で
 *   DB 実装と完全一致 (Mock / DB 両経路の等価性担保)
 * - id は `crypto.randomUUID()` で生成、role は常に `'placeholder'` (Req 2.5, 3.5)
 *
 * 関連: design.md §「ProfileRepository」, requirements.md §2.1, §2.5, §3.4, §3.5
 */

import "server-only";
import type { ProfileRepository } from "@/lib/repositories/profile-repository";
import type {
  PlaceholderProfileInput,
  Profile,
} from "@/types/profile";
import { mockDb } from "./db";
import { today } from "@/lib/utils/date";

export const mockProfileRepo: ProfileRepository = {
  async findById(id) {
    return mockDb.profiles.get(id) ?? null;
  },

  async findByEmail(email) {
    for (const profile of mockDb.profiles.values()) {
      if (profile.email === email) return profile;
    }
    return null;
  },

  async findByDisplayName(name) {
    for (const profile of mockDb.profiles.values()) {
      if (profile.display_name === name) return profile;
    }
    return null;
  },

  async findManyByIds(ids) {
    if (ids.length === 0) return [];
    const idSet = new Set(ids);
    return [...mockDb.profiles.values()].filter((p) => idSet.has(p.id));
  },

  async findAll(options = {}) {
    const all = [...mockDb.profiles.values()];
    if (options.excludePlaceholders) {
      return all.filter((p) => p.role !== "placeholder");
    }
    return all;
  },

  async createPlaceholder(input: PlaceholderProfileInput) {
    const now = today();
    const profile: Profile = {
      id: crypto.randomUUID(),
      email: `placeholder-${input.slug}@local.invalid`,
      display_name: input.displayName,
      avatar_url: null,
      role: "placeholder",
      created_at: now,
      updated_at: now,
    };
    mockDb.profiles.set(profile.id, profile);
    return profile;
  },
};
