/** Phase 1 catalog. Only these two business operations are audited. */
export const AUDIT_EVENTS = {
  salesProgressUpdate: "stores.salesProgress.update",
  storeDelete: "stores.delete",
  authzDenied: "authz.denied",
} as const;

export const SALES_PROGRESS_FIELDS = [
  "appointment_acquired_date",
  "assigned_sales_user_id",
  "memo",
] as const;
export type SalesProgressField = (typeof SALES_PROGRESS_FIELDS)[number];
export type AuditOperation = typeof AUDIT_EVENTS.salesProgressUpdate | typeof AUDIT_EVENTS.storeDelete;
export type DenialReason = "unauthenticated" | "not_admin";

export type ActorSnapshot = { userId: string; email: string };
export type AuditPayload =
  | { changedFields: SalesProgressField[] }
  | { deletionSucceeded: true }
  | { operation: AuditOperation; reason: DenialReason };

export type AuditInput =
  | { event: typeof AUDIT_EVENTS.salesProgressUpdate; actor: ActorSnapshot; storeId: string; payload: { changedFields: SalesProgressField[] } }
  | { event: typeof AUDIT_EVENTS.storeDelete; actor: ActorSnapshot; storeId: string; payload: { deletionSucceeded: true } }
  | { event: typeof AUDIT_EVENTS.authzDenied; actor: ActorSnapshot | null; storeId: null; payload: { operation: AuditOperation; reason: DenialReason } };

export type AuditError = { name: string; message: string; stack?: string };
