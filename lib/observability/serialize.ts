import "server-only";
import { z } from "zod";
import { clipForLog, redactSecrets, LOG_STACK_MAX_CHARS } from "@/lib/utils/log-sanitize";
import { RESEARCH_POLICY_BY_KEY } from "@/lib/domain/research-policy";
import {
  ADOPTION_EFFECT_KINDS,
  AUDIT_EVENTS,
  OVERWRITTEN_ORIGINS,
  REVIEW_COMPLETION_METHODS,
  SALES_PROGRESS_FIELDS,
  type AuditInput,
  type AuditError,
} from "./events";

const actor = z.strictObject({ userId: z.string().uuid(), email: z.string().max(320) });
const storeId = z.string().min(1).max(200);
const runId = z.string().min(1).max(200);

// 調査項目のキーは既知の項目一覧にあるものだけを通す。任意の文字列を許すと、
// キーの位置に店舗情報の値が紛れ込んでも検出できないため。
const researchItemKey = z.string().max(64).refine((key) => RESEARCH_POLICY_BY_KEY.has(key));
// 1 回の調査の項目数 (53) に余裕を持たせた上限。
const MAX_RESEARCH_ITEMS = 200;
const itemCount = z.number().int().min(0).max(MAX_RESEARCH_ITEMS);

const researchReviewDecidePayload = z.discriminatedUnion("decision", [
  z.strictObject({ itemKey: researchItemKey, decision: z.enum(["rejected", "skipped"]) }),
  z.strictObject({
    itemKey: researchItemKey,
    decision: z.literal("adopted"),
    effect: z.enum(ADOPTION_EFFECT_KINDS),
    overwrittenOrigin: z.enum(OVERWRITTEN_ORIGINS).nullable(),
    edited: z.boolean(),
  }).refine((payload) => (payload.effect === "overwrite") === (payload.overwrittenOrigin !== null)),
]);

const researchReviewBulkAdoptPayload = z.strictObject({
  itemKeys: z.array(researchItemKey).min(1).max(MAX_RESEARCH_ITEMS)
    .refine((keys) => new Set(keys).size === keys.length),
  effectCounts: z.strictObject({ new: itemCount, same: itemCount, overwrite: itemCount }),
}).refine((payload) =>
  payload.effectCounts.new + payload.effectCounts.same + payload.effectCounts.overwrite
    === payload.itemKeys.length);

const researchReviewCompletePayload = z.strictObject({
  method: z.enum(REVIEW_COMPLETION_METHODS),
  adoptedCount: itemCount,
  rejectedCount: itemCount,
  skippedCount: itemCount,
  autoSkippedCount: itemCount,
  stageAdvanced: z.boolean(),
}).refine((payload) =>
  payload.autoSkippedCount <= payload.skippedCount
  && (payload.method === "skip_remaining") === (payload.autoSkippedCount > 0));
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
  z.strictObject({
    event: z.literal(AUDIT_EVENTS.researchRunStart), actor, storeId, runId,
    payload: z.strictObject({ stuckRunFailedId: runId.nullable() }),
  }),
  z.strictObject({
    event: z.literal(AUDIT_EVENTS.researchReviewDecide), actor, storeId, runId,
    payload: researchReviewDecidePayload,
  }),
  z.strictObject({
    event: z.literal(AUDIT_EVENTS.researchReviewBulkAdopt), actor, storeId, runId,
    payload: researchReviewBulkAdoptPayload,
  }),
  z.strictObject({
    event: z.literal(AUDIT_EVENTS.researchReviewComplete), actor, storeId, runId,
    payload: researchReviewCompletePayload,
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
