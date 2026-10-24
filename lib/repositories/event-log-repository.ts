import type { eventLogs } from "@/lib/db/schema";

export type EventLogInsert = Omit<typeof eventLogs.$inferInsert, "tenant_id">;

/** Append only. Intentionally not offered through TenantTxRepos: log after commit. */
export interface EventLogRepository {
  insert(event: EventLogInsert): Promise<void>;
}
