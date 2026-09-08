import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TxRepos } from "@/lib/repositories";
import { AUDIT_EVENTS } from "@/lib/observability/events";
import { AUDIT_WRITE_WAIT_MS } from "@/lib/observability/audit";

const mocks = vi.hoisted(() => ({
  profile: vi.fn(), findProfile: vi.fn(), getForUpdate: vi.fn(), update: vi.fn(),
  remove: vi.fn(), insert: vi.fn(), transaction: vi.fn(),
  updateTag: vi.fn(), revalidateTag: vi.fn(), redirect: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ getCurrentProfile: mocks.profile }));
vi.mock("@/lib/repositories", () => ({ repos: {
  store: { delete: mocks.remove }, profile: { findById: mocks.findProfile },
  eventLog: { insert: mocks.insert }, transaction: mocks.transaction,
} }));
vi.mock("next/cache", () => ({ updateTag: mocks.updateTag, revalidateTag: mocks.revalidateTag }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

// Real guards, actor snapshot, serializer and writer. Only I/O is mocked.
import { deleteStoreAction, updateSalesProgressAction } from "../store-actions";

const ACTOR = { id: "11111111-1111-4111-8111-111111111111", email: "admin@example.com", role: "admin" };
const ASSIGNEE = "22222222-2222-4222-8222-222222222222";
const STORE_ID = "store_123";
const current = { id: STORE_ID, memo: "old memo", appointment_acquired_date: null, assigned_sales_user_id: null };
const REDIRECT = new Error("NEXT_REDIRECT");
let order: string[];
function form(fields: Record<string, string> = { memo: "PRIVATE NEW MEMO" }) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.resetAllMocks();
  order = [];
  mocks.profile.mockResolvedValue(ACTOR);
  mocks.findProfile.mockResolvedValue({ id: ASSIGNEE });
  mocks.getForUpdate.mockImplementation(async () => { order.push("lock"); return { ...current }; });
  mocks.update.mockImplementation(async () => { order.push("update"); return { ...current }; });
  mocks.remove.mockImplementation(async () => { order.push("delete"); return true; });
  mocks.transaction.mockImplementation(async (fn: (tx: TxRepos) => Promise<unknown>) => {
    const result = await fn({ store: { getForUpdate: mocks.getForUpdate, update: mocks.update } } as unknown as TxRepos);
    order.push("commit");
    return result;
  });
  mocks.insert.mockImplementation(async () => { order.push("audit"); });
  mocks.updateTag.mockImplementation(() => { order.push("cache"); });
  mocks.revalidateTag.mockImplementation(() => { order.push("cache"); });
  mocks.redirect.mockImplementation(() => { order.push("redirect"); throw REDIRECT; });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("updateSalesProgressAction persistent audit", () => {
  it("records one committed mutation with server actor, actual changed keys and no memo", async () => {
    mocks.profile.mockResolvedValue({ ...ACTOR, role: "member" });
    const result = await updateSalesProgressAction(STORE_ID, form({
      memo: "PRIVATE NEW MEMO", appointment_acquired_date: "2026-09-08",
      assigned_sales_user_id: ASSIGNEE, actor_user_id: ASSIGNEE, actor_email: "spoof@example.com",
    }));
    expect(result.ok).toBe(true);
    expect(mocks.profile).toHaveBeenCalledOnce();
    expect(mocks.getForUpdate).toHaveBeenCalledExactlyOnceWith(STORE_ID);
    expect(mocks.update).toHaveBeenCalledOnce();
    expect(mocks.insert).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      event: "stores.salesProgress.update", kind: "mutation", error: null,
      actor_user_id: ACTOR.id, actor_email: ACTOR.email,
      target_type: "store", target_id: STORE_ID, store_id: STORE_ID,
      payload: { changedFields: ["appointment_acquired_date", "assigned_sales_user_id", "memo"] },
    }));
    expect(JSON.stringify(mocks.insert.mock.calls)).not.toMatch(/PRIVATE|spoof@example|22222222/);
    expect(order.slice(0, 4)).toEqual(["lock", "update", "commit", "audit"]);
    expect(order.indexOf("cache")).toBeGreaterThan(order.indexOf("audit"));
  });

  it("excludes submitted but unchanged fields", async () => {
    await updateSalesProgressAction(STORE_ID, form({ memo: "old memo", appointment_acquired_date: "2026-09-08" }));
    expect(mocks.insert.mock.calls[0]![0].payload).toEqual({ changedFields: ["appointment_acquired_date"] });
  });

  it.each<Record<string, string>>([{}, { memo: "old memo" }, { appointment_acquired_date: "" }, { assigned_sales_user_id: "" }])(
    "does not update or audit a no-op (%j)", async (fields) => {
      expect((await updateSalesProgressAction(STORE_ID, form(fields))).ok).toBe(true);
      expect(mocks.update).not.toHaveBeenCalled();
      expect(mocks.insert).not.toHaveBeenCalled();
    },
  );

  it.each([null, false])("does not audit an update returning %s", async (value) => {
    mocks.update.mockResolvedValue(value);
    expect((await updateSalesProgressAction(STORE_ID, form())).ok).toBe(false);
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.updateTag).not.toHaveBeenCalled();
  });

  it("does not audit a missing Store", async () => {
    mocks.getForUpdate.mockResolvedValue(null);
    expect((await updateSalesProgressAction(STORE_ID, form())).ok).toBe(false);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("does not audit a failed mutation", async () => {
    mocks.update.mockRejectedValue(new Error("business database failed"));
    expect((await updateSalesProgressAction(STORE_ID, form())).ok).toBe(false);
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.updateTag).not.toHaveBeenCalled();
  });

  it("does not audit when the transaction rejects after its callback (rollback/commit failure)", async () => {
    mocks.transaction.mockImplementation(async (fn: (tx: TxRepos) => Promise<unknown>) => {
      await fn({ store: { getForUpdate: mocks.getForUpdate, update: mocks.update } } as unknown as TxRepos);
      expect(mocks.insert).not.toHaveBeenCalled();
      throw new Error("transaction rolled back");
    });
    expect((await updateSalesProgressAction(STORE_ID, form())).ok).toBe(false);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("keeps business success when the real writer's insert fails", async () => {
    mocks.insert.mockRejectedValue(new Error("audit database failed"));
    expect((await updateSalesProgressAction(STORE_ID, form())).ok).toBe(true);
    expect(mocks.updateTag).toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledOnce();
    expect(JSON.parse(vi.mocked(console.error).mock.calls[0]![0]).event).toBe("audit.write_failed");
  });

  it("continues to cache and success after a pending audit reaches its wait bound", async () => {
    vi.useFakeTimers();
    mocks.insert.mockImplementation(() => new Promise<void>(() => undefined));

    const pending = updateSalesProgressAction(STORE_ID, form());
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toContain("commit");
    expect(mocks.insert).toHaveBeenCalledOnce();
    expect(mocks.updateTag).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(AUDIT_WRITE_WAIT_MS);
    expect((await pending).ok).toBe(true);
    expect(mocks.updateTag).toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledOnce();
    expect(JSON.parse(vi.mocked(console.error).mock.calls[0]![0]).event)
      .toBe("audit.write_timed_out");
  });

  it("keeps the committed audit if cache invalidation throws", async () => {
    mocks.updateTag.mockImplementation(() => { throw new Error("cache failed"); });
    await expect(updateSalesProgressAction(STORE_ID, form())).rejects.toThrow("cache failed");
    expect(mocks.insert).toHaveBeenCalledOnce();
  });

  it("records unauthenticated denial once, no mutation or duplicate console", async () => {
    mocks.profile.mockResolvedValue(null);
    expect((await updateSalesProgressAction(STORE_ID, form())).ok).toBe(false);
    expect(mocks.insert).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      event: AUDIT_EVENTS.authzDenied, actor_user_id: null,
      target_id: null, store_id: null,
      payload: { operation: AUDIT_EVENTS.salesProgressUpdate, reason: "unauthenticated" },
    }));
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it.each([
    "store_candidate",
    `AIza${"a".repeat(35)}`,
    "Bearer synthetic-target-token",
  ])("never persists or falls back an unverified denied target (%s)", async (unverifiedId) => {
    mocks.profile.mockResolvedValue(null);
    mocks.insert.mockRejectedValue(new Error("audit unavailable"));

    expect((await updateSalesProgressAction(unverifiedId, form())).ok).toBe(false);

    expect(mocks.insert).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      event: AUDIT_EVENTS.authzDenied,
      target_id: null,
      store_id: null,
    }));
    expect(JSON.stringify(mocks.insert.mock.calls)).not.toContain(unverifiedId);
    expect(console.error).toHaveBeenCalledOnce();
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(unverifiedId);
  });
});

describe("deleteStoreAction persistent audit", () => {
  it("audits successful deletion before cache and redirect, replacing the old console", async () => {
    await expect(deleteStoreAction(STORE_ID)).rejects.toBe(REDIRECT);
    expect(mocks.insert).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      event: "stores.delete", kind: "mutation", actor_user_id: ACTOR.id, actor_email: ACTOR.email,
      target_type: "store", target_id: STORE_ID, store_id: STORE_ID,
      payload: { deletionSucceeded: true }, error: null,
    }));
    expect(order.slice(0, 3)).toEqual(["delete", "audit", "cache"]);
    expect(order.at(-1)).toBe("redirect");
    expect(mocks.redirect).toHaveBeenCalledExactlyOnceWith("/stores");
    expect(console.log).not.toHaveBeenCalled();
  });

  it("awaits audit completion before redirect", async () => {
    let release!: () => void;
    mocks.insert.mockImplementation(() => new Promise<void>((resolve) => { release = resolve; }));
    const pending = deleteStoreAction(STORE_ID).catch((error) => error);
    await vi.waitFor(() => expect(mocks.insert).toHaveBeenCalledOnce());
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
    release();
    expect(await pending).toBe(REDIRECT);
  });

  it("continues to cache and redirect after a pending audit reaches its wait bound", async () => {
    vi.useFakeTimers();
    mocks.insert.mockImplementation(() => new Promise<void>(() => undefined));

    const pending = deleteStoreAction(STORE_ID).catch((error) => error);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.remove).toHaveBeenCalledOnce();
    expect(mocks.insert).toHaveBeenCalledOnce();
    expect(mocks.revalidateTag).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(AUDIT_WRITE_WAIT_MS);
    expect(await pending).toBe(REDIRECT);
    expect(mocks.revalidateTag).toHaveBeenCalled();
    expect(mocks.redirect).toHaveBeenCalledExactlyOnceWith("/stores");
    expect(console.error).toHaveBeenCalledOnce();
    expect(JSON.parse(vi.mocked(console.error).mock.calls[0]![0]).event)
      .toBe("audit.write_timed_out");
  });

  it("does not record a missing Store", async () => {
    mocks.remove.mockResolvedValue(false);
    expect(await deleteStoreAction(STORE_ID)).toEqual({ ok: false, error: "店舗が見つかりませんでした" });
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("does not record a failed delete", async () => {
    mocks.remove.mockRejectedValue({ code: "23503", message: "foreign key", table: "stores" });
    expect((await deleteStoreAction(STORE_ID)).ok).toBe(false);
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("still redirects on audit failure (the Store was deleted)", async () => {
    mocks.insert.mockRejectedValue(new Error("audit offline"));
    await expect(deleteStoreAction(STORE_ID)).rejects.toBe(REDIRECT);
    expect(mocks.remove).toHaveBeenCalledOnce();
    expect(mocks.insert).toHaveBeenCalledOnce();
    expect(console.error).toHaveBeenCalledOnce();
    expect(mocks.revalidateTag).toHaveBeenCalled();
  });

  it("retains the audit when cache invalidation fails after deletion", async () => {
    mocks.revalidateTag.mockImplementation(() => { throw new Error("cache failed"); });
    await expect(deleteStoreAction(STORE_ID)).rejects.toThrow("cache failed");
    expect(mocks.insert).toHaveBeenCalledOnce();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it.each([null, "member", "placeholder"])("records denial once for %s", async (role) => {
    mocks.profile.mockResolvedValue(role ? { ...ACTOR, role } : null);
    expect((await deleteStoreAction(STORE_ID)).ok).toBe(false);
    expect(mocks.insert).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      kind: "authz_denied", event: AUDIT_EVENTS.authzDenied,
      actor_user_id: role ? ACTOR.id : null, actor_email: role ? ACTOR.email : null,
      target_id: null, store_id: null,
      payload: { operation: AUDIT_EVENTS.storeDelete, reason: role ? "not_admin" : "unauthenticated" },
    }));
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("audit failure cannot turn a denial into permission", async () => {
    mocks.profile.mockResolvedValue(null);
    mocks.insert.mockRejectedValue(new Error("offline"));
    expect((await deleteStoreAction(STORE_ID)).ok).toBe(false);
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.insert).toHaveBeenCalledOnce();
  });

  it.each([
    "store_candidate",
    `AIza${"b".repeat(35)}`,
    "Bearer synthetic-delete-token",
  ])("never persists or falls back an unverified delete target (%s)", async (unverifiedId) => {
    mocks.profile.mockResolvedValue(null);
    mocks.insert.mockRejectedValue(new Error("audit unavailable"));

    expect((await deleteStoreAction(unverifiedId)).ok).toBe(false);

    expect(mocks.insert).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      event: AUDIT_EVENTS.authzDenied,
      target_id: null,
      store_id: null,
    }));
    expect(JSON.stringify(mocks.insert.mock.calls)).not.toContain(unverifiedId);
    expect(console.error).toHaveBeenCalledOnce();
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(unverifiedId);
  });
});
