import { describe, expect, it, vi } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { readFileSync } from "node:fs";
import { eventLogs } from "../schema";
import { makeEventLogRepo } from "../event-log-repository";
import type { DbClient } from "../client";
import type { EventLogInsert } from "@/lib/repositories/event-log-repository";

vi.mock("@/lib/db/client", () => ({ db: {} }));

const row: EventLogInsert = {
  id: "evt_test", event: "stores.delete", kind: "mutation", level: "info",
  target_type: "store", target_id: "store_deleted", store_id: "store_deleted",
  actor_user_id: "11111111-1111-4111-8111-111111111111", actor_email: "actor@example.com",
  payload: { deletionSucceeded: true }, error: null,
};

describe("event log repository", () => {
  it("inserts into event_logs without reading a now-deleted Store/profile", async () => {
    const values = vi.fn().mockResolvedValue(undefined);
    const insert = vi.fn().mockReturnValue({ values });
    const repo = makeEventLogRepo({ insert } as unknown as DbClient);
    await repo.insert(row);
    expect(insert).toHaveBeenCalledExactlyOnceWith(eventLogs);
    expect(values).toHaveBeenCalledExactlyOnceWith(row);
  });

  it("propagates SQL failure to the nonthrowing writer", async () => {
    const error = new Error("insert rejected");
    const values = vi.fn().mockRejectedValue(error);
    const repo = makeEventLogRepo({ insert: () => ({ values }) } as unknown as DbClient);
    await expect(repo.insert(row)).rejects.toBe(error);
  });
});

describe("event_logs schema and generated migration (no live DB required)", () => {
  const config = getTableConfig(eventLogs);
  const migration = readFileSync("drizzle/0028_event_log_foundation.sql", "utf8")
    .replace(/--[^\n]*/g, "");
  const snapshot = JSON.parse(readFileSync("drizzle/meta/0028_snapshot.json", "utf8")).tables["public.event_logs"];

  it("preserves evidence after Store/profile deletion: no FK or cascade dependency", () => {
    expect(config.foreignKeys).toHaveLength(0);
    expect(snapshot.foreignKeys).toEqual({});
    expect(migration).not.toMatch(/REFERENCES|FOREIGN KEY|CREATE TRIGGER/i);
    expect(eventLogs.actor_user_id.notNull).toBe(false);
    expect(eventLogs.store_id.notNull).toBe(false);
    expect(eventLogs.target_id.notNull).toBe(false);
  });

  it("uses timestamptz with a database default and the required three indexes", () => {
    expect(eventLogs.occurred_at.getSQLType()).toBe("timestamp with time zone");
    expect(eventLogs.occurred_at.notNull).toBe(true);
    expect(eventLogs.occurred_at.hasDefault).toBe(true);
    expect(config.indexes.map((index) => ({
      name: index.config.name,
      columns: index.config.columns.map((column) => "name" in column ? column.name : "expression"),
    }))).toEqual([
      { name: "event_logs_occurred_at_idx", columns: ["occurred_at"] },
      { name: "event_logs_store_occurred_at_idx", columns: ["store_id", "occurred_at"] },
      { name: "event_logs_event_occurred_at_idx", columns: ["event", "occurred_at"] },
    ]);
    expect(Object.keys(snapshot.indexes)).toHaveLength(3);
    expect(migration.match(/CREATE INDEX/g)).toHaveLength(3);
    expect(migration).toMatch(/"occurred_at" timestamp with time zone DEFAULT now\(\) NOT NULL/);
  });

  it("denies client access: RLS, zero policies, no client grants including TRUNCATE", () => {
    expect(config.enableRLS).toBe(true);
    expect(config.policies).toHaveLength(0);
    expect(snapshot.isRLSEnabled).toBe(true);
    expect(migration).toMatch(/ALTER TABLE "event_logs" ENABLE ROW LEVEL SECURITY/);
    for (const role of ["PUBLIC", "anon", "authenticated"]) {
      expect(migration).toContain(`REVOKE ALL ON TABLE "public"."event_logs" FROM ${role};`);
    }
    expect(migration).not.toMatch(/CREATE POLICY|\bGRANT\b|FORCE ROW LEVEL SECURITY/i);
    // No FORCE RLS means owner/BYPASSRLS server sessions can still INSERT.
    // Static policy verification, not a claim that a live deployment's role was checked.
  });
});
