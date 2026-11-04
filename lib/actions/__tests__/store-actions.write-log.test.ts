/**
 * 店舗の作成・更新が DB エラーになったとき、保存しようとした値をログに残さないこと (#384 のレビュー)。
 *
 * Drizzle の `DrizzleQueryError` は message に `params:` として値をすべて含み、cause の
 * PostgresError の `detail` にも `Failing row contains (...)` として行の値が入る。
 * action が捕まえずに投げると、Next.js がそれをそのままログへ出す。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), findProfile: vi.fn() }));
vi.mock("@/lib/repositories", () => ({
  repos: {
    forTenant: () => ({
      store: { create: mocks.create, update: mocks.update },
      membership: { find: mocks.findProfile },
    }),
  },
}));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn(), updateTag: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  getCurrentProfile: async () => ({ id: "00000000-0000-4000-8000-000000000001" }),
}));

const { createStoreAction, updateStoreAction, updateStorePatchAction, updateStoreStageAction } =
  await import("../store-actions");

const EMAIL = "leak-check-384@example.com";
const PHONE = "03-9999-0384";

/** Drizzle が投げる形 (message に params、cause に PostgresError)。 */
function drizzleQueryError(): Error {
  const cause = Object.assign(new Error('null value in column "name" violates not-null constraint'), {
    name: "PostgresError",
    code: "23502",
    detail: `Failing row contains (store_1, ${EMAIL}, ${PHONE}).`,
    table_name: "stores",
    column_name: "name",
  });
  return Object.assign(
    new Error(`Failed query: update "stores" set "contact_email" = $1, "phone" = $2\\nparams: ${EMAIL},${PHONE}`),
    { name: "DrizzleQueryError", cause },
  );
}

function form(fields: Record<string, string>): FormData {
  const formData = new FormData();
  formData.set("name", "導楽");
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);
  return formData;
}

let errorLog: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  mocks.create.mockReset().mockRejectedValue(drizzleQueryError());
  mocks.update.mockReset().mockRejectedValue(drizzleQueryError());
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("店舗の作成・更新の DB エラー", () => {
  it.each([
    ["作成", () => createStoreAction(null, form({ contact_email: EMAIL, phone: PHONE }))],
    ["全体の編集", () => updateStoreAction("store_1", null, form({ contact_email: EMAIL, phone: PHONE }))],
    ["部分更新", () => updateStorePatchAction("store_1", { contact_email: EMAIL, phone: PHONE })],
    ["段階の変更", () => updateStoreStageAction("store_1", "調査済み")],
  ])("%s: 失敗を返し、ログには SQLSTATE などだけを残して値を残さない", async (_label, run) => {
    const result = await run();
    expect(result.ok).toBe(false);
    const logged = JSON.stringify(errorLog.mock.calls);
    expect(logged).not.toContain(EMAIL);
    expect(logged).not.toContain(PHONE);
    expect(errorLog.mock.calls[0]?.[1]).toMatchObject({ code: "23502", table: "stores", column: "name" });
  });
});
