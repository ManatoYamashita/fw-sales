import "server-only";
import { z } from "zod";
import { clipForLog, redactSecrets, LOG_STACK_MAX_CHARS } from "@/lib/utils/log-sanitize";
import { AUDIT_EVENTS, SALES_PROGRESS_FIELDS, type AuditInput, type AuditError } from "./events";

const actor = z.strictObject({ userId: z.string().uuid(), email: z.string().max(320) });
const storeId = z.string().min(1).max(200);
const auditSchema = z.discriminatedUnion("event", [
  z.strictObject({
    event: z.literal(AUDIT_EVENTS.salesProgressUpdate), actor, storeId,
    payload: z.strictObject({ changedFields: z.array(z.enum(SALES_PROGRESS_FIELDS)).min(1).max(3)
      .refine((fields) => new Set(fields).size === fields.length) }),
  }),
  z.strictObject({
    event: z.literal(AUDIT_EVENTS.storeDelete), actor, storeId,
    payload: z.strictObject({ deletionSucceeded: z.literal(true) }),
  }),
  z.strictObject({
    event: z.literal(AUDIT_EVENTS.authzDenied), actor: actor.nullable(), storeId: z.null(),
    payload: z.strictObject({
      operation: z.enum([AUDIT_EVENTS.salesProgressUpdate, AUDIT_EVENTS.storeDelete]),
      reason: z.enum(["unauthenticated", "not_admin"]),
    }),
  }),
]);

/** Runtime strict allowlist too: no FormData, memo, extra keys, or unbounded trees. */
export function serializeAuditInput(input: AuditInput): AuditInput {
  return auditSchema.parse(input);
}

function safeText(value: string, maxChars: number): string {
  return clipForLog(redactSecrets(value)
    .replace(/\b(Bearer\s+)[^\s"']+/gi, "$1[REDACTED]")
    .replace(/(postgres(?:ql)?:\/\/)[^\s/@]+(?::[^\s/@]*)?@/gi, "$1[REDACTED]@"), maxChars);
}

const ERROR_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/;

/**
 * Persistence failures may contain SQL + parameter values. Never retain their
 * message, detail, query, params or arbitrary properties. Keep only a bounded
 * exception name and stack frames (not the first line containing the message).
 * Successful mutation rows always have error=null.
 */
export function serializeAuditError(error: unknown): AuditError {
  const result: AuditError = { name: "Error", message: "Audit event could not be persisted" };
  try {
    if (!(error instanceof Error)) return result;
    const rawName = error.name;
    const rawMessage = error.message;
    const rawStack = error.stack;
    result.name = ERROR_NAME_PATTERN.test(rawName) ? rawName : "Error";

    // V8 prefixes stack with the complete `${name}: ${message}` string. Remove
    // that exact prefix before accepting frames, so multiline message content
    // can never be mistaken for a frame. Unknown stack formats are omitted.
    const messagePrefix = `${rawName}: ${rawMessage}`;
    const frames = rawStack?.startsWith(messagePrefix)
      ? rawStack.slice(messagePrefix.length).split("\n")
        .filter((line) => /^\s+at\s/.test(line)).join("\n")
      : undefined;
    if (frames) result.stack = safeText(frames, LOG_STACK_MAX_CHARS);
  } catch {
    // Even a throwing property getter must not turn an audit failure into a business failure.
  }
  return result;
}
