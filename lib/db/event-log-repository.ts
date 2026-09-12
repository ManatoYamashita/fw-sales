import "server-only";
import { auditDb } from "./audit-client";
import { eventLogs } from "./schema";
import type { DbClient } from "./client";
import type { EventLogRepository } from "@/lib/repositories/event-log-repository";

export function makeEventLogRepo(executor: DbClient): EventLogRepository {
  return {
    async insert(event) {
      await executor.insert(eventLogs).values(event);
    },
  };
}

/**
 * 監査書込みは業務プールではなく専用プール (`auditDb`) 上で行う。
 * 停滞した監査 INSERT が業務 query の接続を奪わないようにするため
 * (PR #282 friend review P1 / `lib/db/audit-client.ts` 参照)。
 */
export const dbEventLogRepo = makeEventLogRepo(auditDb);
