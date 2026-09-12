import "server-only";
import { randomUUID } from "node:crypto";
import { AUDIT_EVENTS, type AuditInput } from "./events";
import { serializeAuditError, serializeAuditInput } from "./serialize";
import type { EventLogInsert } from "@/lib/repositories/event-log-repository";

// Audit is best-effort after the business commit. Waiting 1.5 seconds gives a
// normal DB INSERT time to finish without letting a stuck audit connection hold
// a user-visible Server Action until the platform timeout.
//
// This is the OUTER boundary only. The audit INSERT runs on a dedicated pool
// (`lib/db/audit-client.ts`) whose connection carries a shorter DB-side
// `statement_timeout`, so PostgreSQL normally aborts a stalled INSERT and frees
// the connection before this deadline is reached. Keep
// AUDIT_DB_STATEMENT_TIMEOUT_MS < AUDIT_WRITE_WAIT_MS.
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
 *
 * The INSERT runs on the dedicated audit pool, never on the business pool, so a
 * stalled audit write cannot consume the business connection budget
 * (`DATABASE_POOL_MAX`). That pool's connection also carries a DB-side
 * `statement_timeout`, which bounds the query itself rather than only this
 * caller's wait.
 *
 * Still best-effort: no retry, no outbox, and no delivery guarantee across a
 * process crash. If the DB-side bound is disabled or not honoured by an
 * intermediary, a timed-out INSERT may still settle after the caller continued;
 * the timed_out fallback therefore reports an unknown outcome.
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
    // The DB-side statement_timeout normally settles this first (57014), but if
    // it is disabled the outer race can still win; this already-settled Promise
    // consumes the late rejection either way and prevents an unhandled
    // rejection. There is deliberately no retry.
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
