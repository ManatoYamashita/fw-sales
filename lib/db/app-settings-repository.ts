/**
 * AppSettingsRepository の Drizzle 実装 (store-flow-guidance / Issue #122)
 *
 * `lib/repositories/app-settings-repository.ts` の interface を Drizzle で 1:1 実装。
 *
 * 制約:
 * - `import "server-only"` を必ず付け、Client バンドルへの混入を防ぐ
 * - `set` は `(tenant_id, key)` 競合時に値を更新する upsert。
 *   先にexpand migration 0033を適用する。旧global PK撤去後も同じSQLを使用する。
 *
 * 関連: Issue #122, lib/repositories/app-settings-repository.ts
 */

import "server-only";

import { and, eq } from "drizzle-orm";
import { type DbClient, type Tx } from "./client";
import { appSettings } from "./schema";
import type { AppSettingsRepository } from "@/lib/repositories/app-settings-repository";
import { today } from "@/lib/utils/date";

export function makeAppSettingsRepo(
  executor: DbClient | Tx,
  tenantId: string,
): AppSettingsRepository {
  return {
    async get(key) {
      const rows = await executor
        .select()
        .from(appSettings)
        .where(and(eq(appSettings.tenant_id, tenantId), eq(appSettings.key, key)))
        .limit(1);
      return rows[0]?.value ?? null;
    },

    async set(key, value) {
      const now = today();
      try {
        const rows = await executor
          .insert(appSettings)
          .values({ tenant_id: tenantId, key, value, updated_at: now })
          .onConflictDoUpdate({
            target: [appSettings.tenant_id, appSettings.key],
            set: { value, updated_at: now },
            setWhere: eq(appSettings.tenant_id, tenantId),
          }).returning({ key: appSettings.key });
        if (rows.length === 0) throw new Error("設定を保存できませんでした");
      } catch (cause) {
        // 移行中に旧global PKへ衝突しても、他社の値・DB内部情報を返さない。
        throw new Error("設定を保存できませんでした", { cause });
      }
    },
  };
}
