import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUDIT_EVENTS, type AuditInput } from "../events";
import { serializeAuditError, serializeAuditInput } from "../serialize";
import { AUDIT_WRITE_WAIT_MS, writeAudit } from "../audit";

const { insert } = vi.hoisted(() => ({ insert: vi.fn() }));
vi.mock("@/lib/repositories", () => ({ repos: { eventLog: { insert } } }));

const input: AuditInput = {
  event: AUDIT_EVENTS.salesProgressUpdate,
  actor: { userId: "11111111-1111-4111-8111-111111111111", email: "actor@example.com" },
  storeId: "store_123", payload: { changedFields: ["memo"] },
};

beforeEach(() => {
  insert.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("persistent audit writer", () => {
  it("persists a bounded, actor-attributed event once", async () => {
    await writeAudit(input);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith({
      id: expect.stringMatching(/^evt_[0-9a-f-]{36}$/), occurred_at: expect.any(Date),
      event: "stores.salesProgress.update", kind: "mutation", level: "info",
      actor_user_id: input.actor!.userId, actor_email: "actor@example.com",
      target_type: "store", target_id: "store_123", store_id: "store_123",
      payload: { changedFields: ["memo"] }, error: null,
    });
    expect(console.error).not.toHaveBeenCalled();
  });

  it("awaits persistence, not a detached promise", async () => {
    let release!: () => void;
    insert.mockImplementation(() => new Promise<void>((resolve) => { release = resolve; }));
    let completed = false;
    const pending = writeAudit(input).then(() => { completed = true; });
    await vi.waitFor(() => expect(insert).toHaveBeenCalledOnce());
    expect(completed).toBe(false);
    release();
    await pending;
  });

  it("bounds a permanently pending write and reports an unknown outcome once", async () => {
    vi.useFakeTimers();
    insert.mockImplementation(() => new Promise<void>(() => undefined));

    let completed = false;
    const pending = writeAudit(input).then(() => { completed = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(insert).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(AUDIT_WRITE_WAIT_MS - 1);
    expect(completed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await pending;

    expect(console.error).toHaveBeenCalledOnce();
    expect(JSON.parse(vi.mocked(console.error).mock.calls[0]![0])).toEqual(
      expect.objectContaining({
        event: "audit.write_timed_out",
        outcome: "unknown",
        wait_ms: AUDIT_WRITE_WAIT_MS,
      }),
    );
  });

  it("consumes a late rejection after timeout without a second fallback", async () => {
    vi.useFakeTimers();
    let rejectWrite!: (reason: unknown) => void;
    insert.mockImplementation(() => new Promise<void>((_resolve, reject) => {
      rejectWrite = reject;
    }));

    const pending = writeAudit(input);
    await vi.advanceTimersByTimeAsync(AUDIT_WRITE_WAIT_MS);
    await pending;
    rejectWrite(new Error("late driver failure"));
    await vi.advanceTimersByTimeAsync(0);

    expect(console.error).toHaveBeenCalledOnce();
    expect(JSON.parse(vi.mocked(console.error).mock.calls[0]![0]).event)
      .toBe("audit.write_timed_out");
  });

  it("catches insert failure; one safe console fallback, no retry", async () => {
    const error = Object.assign(new Error("password=secret SQL params CUSTOMER TEXT"), { detail: "PRIVATE" });
    insert.mockRejectedValue(error);
    await expect(writeAudit(input)).resolves.toBeUndefined();
    expect(insert).toHaveBeenCalledOnce();
    expect(console.error).toHaveBeenCalledOnce();
    const fallback = JSON.parse(vi.mocked(console.error).mock.calls[0]![0]);
    expect(fallback.event).toBe("audit.write_failed");
    expect(fallback.audit.store_id).toBe("store_123");
    expect(fallback.error.stack).toContain("at ");
    expect(JSON.stringify(fallback)).not.toMatch(/password=secret|CUSTOMER TEXT|PRIVATE/);
  });

  it("does not throw even when the fallback sink throws", async () => {
    insert.mockRejectedValue(new Error("offline"));
    vi.mocked(console.error).mockImplementation(() => { throw new Error("sink broken"); });
    await expect(writeAudit(input)).resolves.toBeUndefined();
  });

  it("does not leak a multiline driver message through the console fallback", async () => {
    const error = new Error("driver message\n    at refresh_token=synthetic-secret");
    error.stack = `${error.name}: ${error.message}\n    at persist (D:/app/audit.ts:10:4)`;
    insert.mockRejectedValue(error);

    await writeAudit(input);

    expect(console.error).toHaveBeenCalledOnce();
    const fallback = JSON.parse(vi.mocked(console.error).mock.calls[0]![0]);
    expect(fallback.error.stack).toBe("    at persist (D:/app/audit.ts:10:4)");
    expect(JSON.stringify(fallback)).not.toMatch(/synthetic-secret|refresh_token|driver message/);
  });

  it.each([
    { ...input, payload: { changedFields: ["memo"], memo: "PRIVATE" } },
    { ...input, payload: { changedFields: ["password"] } },
    { ...input, payload: { changedFields: ["memo", "memo"] } },
    { ...input, payload: { changedFields: [] } },
    { ...input, payload: new FormData() },
    { ...input, payload: { changedFields: ["memo"], nested: { secret: "PRIVATE" } } },
    { ...input, extra: "PRIVATE" },
    { ...input, storeId: "x".repeat(201) },
    { ...input, event: "arbitrary.event" },
    { ...input, actor: null },
    { event: AUDIT_EVENTS.authzDenied, actor: null, storeId: "unverified",
      payload: { operation: AUDIT_EVENTS.storeDelete, reason: "unauthenticated" } },
  ])("rejects unsafe input at runtime without leaking it", async (unsafe) => {
    expect(() => serializeAuditInput(unsafe as AuditInput)).toThrow();
    await expect(writeAudit(unsafe as AuditInput)).resolves.toBeUndefined();
    expect(insert).not.toHaveBeenCalled();
    const fallback = JSON.parse(vi.mocked(console.error).mock.calls[0]![0]);
    expect(fallback.audit).toBeNull();
    expect(JSON.stringify(fallback)).not.toContain("PRIVATE");
  });

  it("supports nullable actor for denial, but not a mutation", async () => {
    await writeAudit({ event: AUDIT_EVENTS.authzDenied, actor: null, storeId: null,
      payload: { operation: AUDIT_EVENTS.storeDelete, reason: "unauthenticated" } });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ kind: "authz_denied", level: "warn", actor_user_id: null }));
  });
});

describe("error serialization", () => {
  it("extracts non-enumerable stack, redacts BEFORE clipping, retains ordinary frames", () => {
    const key = `AIza${"a".repeat(35)}`;
    const error = new Error("do not retain SQL / arbitrary message");
    error.stack = `Error: ${error.message}\n    at store_123 (D:/app/a.ts:3:4)\n    at fetch (Bearer sensitive-token)\n    at connect (postgres://user:pass@db/production)\n    at ${"x".repeat(790)}${key}${"x".repeat(500)}`;
    const safe = serializeAuditError(error);
    expect(safe.stack).toContain("store_123 (D:/app/a.ts:3:4)");
    expect(safe.stack).toContain("[REDACTED]");
    expect(safe.stack!.length).toBeLessThan(1020);
    expect(safe.stack).toContain("…(");
    expect(JSON.stringify(safe)).not.toMatch(/AIza|sensitive-token|user:pass|do not retain SQL/);
  });

  it("removes a complete multiline message before extracting stack frames", () => {
    const error = new Error("driver message\n    at refresh_token=synthetic-secret");
    error.stack = `${error.name}: ${error.message}\n    at persist (D:/app/audit.ts:10:4)`;

    const safe = serializeAuditError(error);

    expect(safe.stack).toBe("    at persist (D:/app/audit.ts:10:4)");
    expect(JSON.stringify(safe)).not.toMatch(/synthetic-secret|refresh_token|driver message/);
  });

  it("omits stack when its message prefix cannot be separated safely", () => {
    const error = new Error("PRIVATE multiline\n    at token=synthetic-secret");
    error.stack = "Error: different header\n    at safe (D:/app/audit.ts:10:4)";
    const safe = serializeAuditError(error);
    expect(safe.stack).toBeUndefined();
    expect(JSON.stringify(safe)).not.toMatch(/PRIVATE|synthetic-secret/);
  });

  it("handles normal errors, missing stack and malicious names without throwing", () => {
    const normal = serializeAuditError(new Error("ordinary driver failure"));
    expect(normal.name).toBe("Error");
    expect(normal.stack).toContain("at ");

    const withoutStack = new Error("PRIVATE");
    withoutStack.stack = undefined;
    expect(serializeAuditError(withoutStack).stack).toBeUndefined();

    const maliciousName = new Error("PRIVATE");
    maliciousName.name = "Error\nrefresh_token=synthetic-secret";
    maliciousName.stack = `${maliciousName.name}: ${maliciousName.message}\n    at safe (D:/app/audit.ts:10:4)`;
    const safeName = serializeAuditError(maliciousName);
    expect(safeName.name).toBe("Error");
    expect(JSON.stringify(safeName)).not.toMatch(/synthetic-secret|refresh_token|PRIVATE/);
  });

  it("never serializes arbitrary objects, causes, or throwing getters", () => {
    const error = new Error("PRIVATE");
    Object.defineProperty(error, "stack", { get() { throw new Error("getter"); } });
    for (const value of [error, { message: "PRIVATE", secret: "PRIVATE" }, "PRIVATE", null]) {
      expect(() => serializeAuditError(value)).not.toThrow();
      expect(JSON.stringify(serializeAuditError(value))).not.toContain("PRIVATE");
    }
  });
});

// Compile-time contract as well as runtime validation above.
function typeContract() {
  // @ts-expect-error arbitrary payload fields are not accepted
  void writeAudit({ ...input, payload: { memo: "forbidden" } });
}
void typeContract;
