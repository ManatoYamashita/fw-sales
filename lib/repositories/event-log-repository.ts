import type { eventLogs } from "@/lib/db/schema";

export type EventLogInsert = typeof eventLogs.$inferInsert;

/** Append only. Intentionally not offered through TxRepos: log after commit. */
export interface EventLogRepository {
  insert(event: EventLogInsert): Promise<void>;
}
