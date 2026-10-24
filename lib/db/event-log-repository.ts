import "server-only";
import { eventLogs } from "./schema";
import type { DbClient } from "./client";
import type { EventLogRepository } from "@/lib/repositories/event-log-repository";

export function makeEventLogRepo(executor: DbClient, tenantId: string): EventLogRepository {
  return {
    async insert(event) {
      await executor.insert(eventLogs).values({ ...event, tenant_id: tenantId });
    },
  };
}
