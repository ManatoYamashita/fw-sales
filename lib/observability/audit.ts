import "server-only";
import { randomUUID } from "node:crypto";
import { AUDIT_EVENTS, type AuditInput } from "./events";
import { serializeAuditError, serializeAuditInput } from "./serialize";
import type { EventLogInsert } from "@/lib/repositories/event-log-repository";

// Audit is best-effort after the business commit. Waiting 1.5 seconds gives a
// normal DB INSERT time to finish without letting a stuck audit connection hold
// a user-visible Server Action until the platform timeout.
export const AUDIT_WRITE_WAIT_MS = 1_500;

type WriteOutcome =
  | { status: "persisted" }
  | { status: "rejected"; error: unknown }
  | { status: "timed_out" };

function consoleFallback(
  event: "audit.write_failed" | "audit.write_timed_out",
  row: EventLogInsert | null,
  error?: unknown,
): void {
  try {
    console.error(JSON.stringify({
      level: "error",
      event,
      outcome: event === "audit.write_timed_out" ? "unknown" : "failed",
      ...(event === "audit.write_timed_out" ? { wait_ms: AUDIT_WRITE_WAIT_MS } : {}),
      audit: row,
      ...(event === "audit.write_failed" ? { error: serializeAuditError(error) } : {}),
    }));
  } catch {
    // A broken console sink must not reject the caller either.
  }
}

/**
 * Await only AFTER business commit, before cache invalidation/redirect.
 * Uses the existing business DB client. This is not an instrumentation logger:
 * its import-time health check / process.exit behavior is deliberately unchanged.
 * No retry, cancellation, or delivery guarantee across a process crash. A
 * timed-out INSERT may settle after the caller has continued.
 */
export async function writeAudit(input: AuditInput): Promise<void> {
  let row: EventLogInsert | undefined;
  try {
    const safe = serializeAuditInput(input);
    const denied = safe.event === AUDIT_EVENTS.authzDenied;
    row = {
      id: `evt_${randomUUID()}`,
      occurred_at: new Date(),
      level: denied ? "warn" : "info",
      kind: denied ? "authz_denied" : "mutation",
      event: safe.event,
      actor_user_id: safe.actor?.userId ?? null,
      actor_email: safe.actor?.email ?? null,
      target_type: "store",
      target_id: safe.storeId,
      store_id: safe.storeId,
      payload: safe.payload,
      error: null,
    };

    // Attach both fulfillment and rejection handlers before racing the timer.
    // If timeout wins, the INSERT is not cancelled and may still commit later;
    // this settled Promise consumes a late rejection and prevents it from
    // becoming an unhandled rejection. There is deliberately no retry.
    const settledWrite: Promise<WriteOutcome> = (async () => {
      const { repos } = await import("@/lib/repositories");
      await repos.eventLog.insert(row!);
    })().then(
      (): WriteOutcome => ({ status: "persisted" }),
      (error: unknown): WriteOutcome => ({ status: "rejected", error }),
    );

    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<WriteOutcome>((resolve) => {
      timeout = setTimeout(() => resolve({ status: "timed_out" }), AUDIT_WRITE_WAIT_MS);
    });
    const outcome = await Promise.race([settledWrite, timedOut]);
    if (timeout !== undefined) clearTimeout(timeout);

    if (outcome.status === "rejected") {
      consoleFallback("audit.write_failed", row, outcome.error);
    } else if (outcome.status === "timed_out") {
      consoleFallback("audit.write_timed_out", row);
    }
  } catch (error) {
    // Never print unvalidated input or raw driver errors. One fallback only;
    // no second persistence attempt that could recurse or duplicate a commit.
    consoleFallback("audit.write_failed", row ?? null, error);
  }
}
