/**
 * AppSettingsRepository の Drizzle 実装 (store-flow-guidance / Issue #122)
 *
 * `lib/repositories/app-settings-repository.ts` の interface を Drizzle で 1:1 実装。
 *
 * 制約:
 * - `import "server-only"` を必ず付け、Client バンドルへの混入を防ぐ
 * - `set` は PK (`key`) 競合時に値を更新する upsert (`onConflictDoUpdate`)
 *
 * 関連: Issue #122, lib/repositories/app-settings-repository.ts
 */

import "server-only";

import { eq } from "drizzle-orm";
import { db, type DbClient, type Tx } from "./client";
import { appSettings } from "./schema";
import type { AppSettingsRepository } from "@/lib/repositories/app-settings-repository";
import { today } from "@/lib/utils/date";

export function makeAppSettingsRepo(
  executor: DbClient | Tx,
): AppSettingsRepository {
  return {
    async get(key) {
      const rows = await executor
        .select()
        .from(appSettings)
        .where(eq(appSettings.key, key))
        .limit(1);
      return rows[0]?.value ?? null;
    },

    async set(key, value) {
      const now = today();
      await executor
        .insert(appSettings)
        .values({ key, value, updated_at: now })
        .onConflictDoUpdate({
          target: appSettings.key,
          set: { value, updated_at: now },
        });
    },
  };
}

export const dbAppSettingsRepo: AppSettingsRepository = makeAppSettingsRepo(db);
