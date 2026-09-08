import "server-only";
import { db, type DbClient } from "./client";
import { eventLogs } from "./schema";
import type { EventLogRepository } from "@/lib/repositories/event-log-repository";

export function makeEventLogRepo(executor: DbClient): EventLogRepository {
  return {
    async insert(event) {
      await executor.insert(eventLogs).values(event);
    },
  };
}

export const dbEventLogRepo = makeEventLogRepo(db);
