/**
 * prompt-template-actions のユニットテスト (Issue #42 Phase 2)
 *
 * テスト方針:
 * - @/lib/repositories, @/lib/supabase/server, next/cache をモックして副作用を排除
 * - vi.hoisted でモックオブジェクトを定義し、vi.mock factory から参照する
 * - 認証・バリデーション・上限チェック・is_default 制御・transaction を検証する
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// vi.hoisted: vi.mock factory より前に評価されるため、factory 内で参照できる
// ---------------------------------------------------------------------------

const { mockRepo, mockTransaction, mockGetCurrentSession } = vi.hoisted(() => ({
  mockRepo: {
    list: vi.fn(),
    findById: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    countByUser: vi.fn(),
    clearDefaultForUser: vi.fn(),
    setDefault: vi.fn(),
  },
  mockTransaction: vi.fn(),
  mockGetCurrentSession: vi.fn(),
}));

vi.mock("@/lib/repositories", () => ({
  repos: {
    promptTemplate: mockRepo,
    transaction: mockTransaction,
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  getCurrentSession: mockGetCurrentSession,
}));

vi.mock("next/cache", () => ({
  updateTag: vi.fn(),
}));

import {
  listPromptTemplatesAction,
  createPromptTemplateAction,
  updatePromptTemplateAction,
  deletePromptTemplateAction,
  setDefaultPromptTemplateAction,
} from "../prompt-template-actions";
import type { AiPromptTemplate } from "@/types/ai-prompt-template";
import {
  serializeFewshots,
  serializeFreeform,
  MAX_FREEFORM_LENGTH,
} from "@/types/ai-prompt-template";

// ---------------------------------------------------------------------------
// テストデータ
// ---------------------------------------------------------------------------

const USER_A = "user-uuid-a";
const USER_B = "user-uuid-b";
const TEMPLATE_ID = "f47ac10b-58cc-4372-a567-0e02b2c3d479";

const SESSION_A = { userId: USER_A, email: "a@test.com" };

function makeTemplateRow(
  overrides: Partial<AiPromptTemplate> = {},
): AiPromptTemplate {
  return {
    id: TEMPLATE_ID,
    user_id: USER_A,
    name: "テストテンプレート",
    is_default: false,
    body: makeValidBody(),
    created_at: "2026-05-24",
    updated_at: "2026-05-24",
    ...overrides,
  };
}

function makeValidBody(count = 1): string {
  const examples = Array.from({ length: count }, (_, i) => ({
    title: `タイトル${i + 1}`,
    store_meta: `店舗情報${i + 1}`,
    call_script_ideal: `私ファーストWEBの{ASSIGNED_SALES}と申します例${i + 1}`,
  }));
  return serializeFewshots(examples);
}

function makeCreateFormData(
  overrides: Record<string, string> = {},
): FormData {
  const fd = new FormData();
  fd.set("name", "新規テンプレート");
  fd.set("body", makeValidBody());
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
  return fd;
}

function makeUpdateFormData(
  overrides: Record<string, string> = {},
): FormData {
  const fd = new FormData();
  fd.set("id", TEMPLATE_ID);
  fd.set("name", "更新テンプレート");
  fd.set("body", makeValidBody());
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
  return fd;
}

// ---------------------------------------------------------------------------
// セットアップ
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.resetAllMocks();
});

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

describe("listPromptTemplatesAction", () => {
  it("未ログインならfailure", async () => {
    mockGetCurrentSession.mockResolvedValue(null);
    const result = await listPromptTemplatesAction();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/ログイン/);
    expect(mockRepo.list).not.toHaveBeenCalled();
  });

  it("ログイン中なら自分のテンプレート一覧を返す", async () => {
    const rows = [makeTemplateRow(), makeTemplateRow({ id: "t2", name: "B" })];
    mockGetCurrentSession.mockResolvedValue(SESSION_A);
    mockRepo.list.mockResolvedValue(rows);

    const result = await listPromptTemplatesAction();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(2);
      expect(result.data[0]?.user_id).toBe(USER_A);
    }
    expect(mockRepo.list).toHaveBeenCalledWith(USER_A);
  });
});

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

describe("createPromptTemplateAction", () => {
  it("正常に作成できる", async () => {
    const created = makeTemplateRow({ name: "新規テンプレート" });
    mockGetCurrentSession.mockResolvedValue(SESSION_A);
    mockTransaction.mockImplementationOnce(
      (fn: (tx: { promptTemplate: typeof mockRepo }) => Promise<AiPromptTemplate>) =>
        fn({ promptTemplate: { ...mockRepo, countByUser: vi.fn().mockResolvedValue(2), insert: vi.fn().mockResolvedValue(created) } }),
    );

    const result = await createPromptTemplateAction(makeCreateFormData());

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.name).toBe("新規テンプレート");
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });

  it("未ログインならfailure", async () => {
    mockGetCurrentSession.mockResolvedValue(null);
    const result = await createPromptTemplateAction(makeCreateFormData());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/ログイン/);
    expect(mockRepo.insert).not.toHaveBeenCalled();
  });

  it("6件目作成は failure(上限 5 件を超えました)", async () => {
    mockGetCurrentSession.mockResolvedValue(SESSION_A);
    mockTransaction.mockImplementationOnce(
      (fn: (tx: { promptTemplate: typeof mockRepo }) => Promise<AiPromptTemplate>) =>
        fn({ promptTemplate: { ...mockRepo, countByUser: vi.fn().mockResolvedValue(5) } }),
    );

    const result = await createPromptTemplateAction(makeCreateFormData());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/上限.*5/);
  });

  it("name が空文字なら failure", async () => {
    mockGetCurrentSession.mockResolvedValue(SESSION_A);
    const result = await createPromptTemplateAction(
      makeCreateFormData({ name: "" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/テンプレート名/);
    expect(mockRepo.insert).not.toHaveBeenCalled();
  });

  it("name が空白のみなら failure", async () => {
    mockGetCurrentSession.mockResolvedValue(SESSION_A);
    const result = await createPromptTemplateAction(
      makeCreateFormData({ name: "   " }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/テンプレート名/);
    expect(mockRepo.insert).not.toHaveBeenCalled();
  });

  it("前後空白つき name は trim されて insert される", async () => {
    const created = makeTemplateRow({ name: "テスト" });
    mockGetCurrentSession.mockResolvedValue(SESSION_A);
    const txInsert = vi.fn().mockResolvedValue(created);
    mockTransaction.mockImplementationOnce(
      (fn: (tx: { promptTemplate: typeof mockRepo }) => Promise<AiPromptTemplate>) =>
        fn({ promptTemplate: { ...mockRepo, countByUser: vi.fn().mockResolvedValue(1), insert: txInsert } }),
    );

    const result = await createPromptTemplateAction(
      makeCreateFormData({ name: "  テスト  " }),
    );

    expect(result.ok).toBe(true);
    const [insertInput] = txInsert.mock.calls[0] as [{ name: string }];
    expect(insertInput.name).toBe("テスト");
  });

  it("body が不正 JSON なら failure", async () => {
    mockGetCurrentSession.mockResolvedValue(SESSION_A);
    const result = await createPromptTemplateAction(
      makeCreateFormData({ body: "not-json" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/不正/);
    expect(mockRepo.insert).not.toHaveBeenCalled();
  });

  it("fewshots が 0 件なら failure", async () => {
    mockGetCurrentSession.mockResolvedValue(SESSION_A);
    const result = await createPromptTemplateAction(
      makeCreateFormData({ body: makeValidBody(0) }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/1 件以上/);
    expect(mockRepo.insert).not.toHaveBeenCalled();
  });

  it("fewshots が 11 件なら failure", async () => {
    mockGetCurrentSession.mockResolvedValue(SESSION_A);
    const result = await createPromptTemplateAction(
      makeCreateFormData({ body: makeValidBody(11) }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/10 件以内/);
    expect(mockRepo.insert).not.toHaveBeenCalled();
  });

  it("call_script_ideal が 2000 字超過なら failure", async () => {
    mockGetCurrentSession.mockResolvedValue(SESSION_A);
    const body = serializeFewshots([
      {
        title: "タイトル",
        store_meta: "店舗情報",
        call_script_ideal: "{ASSIGNED_SALES}" + "あ".repeat(2000),
      },
    ]);
    const result = await createPromptTemplateAction(
      makeCreateFormData({ body }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/2000/);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("{ASSIGNED_SALES} がない場合は failure", async () => {
    mockGetCurrentSession.mockResolvedValue(SESSION_A);
    const body = serializeFewshots([
      { title: "タイトル", store_meta: "店舗情報", call_script_ideal: "プレースホルダーなし" },
    ]);
    const result = await createPromptTemplateAction(
      makeCreateFormData({ body }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/\{ASSIGNED_SALES\}/);
    expect(mockRepo.insert).not.toHaveBeenCalled();
  });

  it("1 件目作成時は is_default: true で insert される", async () => {
    const created = makeTemplateRow({ is_default: true });
    mockGetCurrentSession.mockResolvedValue(SESSION_A);
    const txInsert = vi.fn().mockResolvedValue(created);
    mockTransaction.mockImplementationOnce(
      (fn: (tx: { promptTemplate: typeof mockRepo }) => Promise<AiPromptTemplate>) =>
        fn({ promptTemplate: { ...mockRepo, countByUser: vi.fn().mockResolvedValue(0), insert: txInsert } }),
    );

    const result = await createPromptTemplateAction(makeCreateFormData());

    expect(result.ok).toBe(true);
    const [insertInput] = txInsert.mock.calls[0] as [
      { is_default: boolean },
    ];
    expect(insertInput.is_default).toBe(true);
  });

  it("2 件目以降は is_default: false で insert される", async () => {
    const created = makeTemplateRow({ is_default: false });
    mockGetCurrentSession.mockResolvedValue(SESSION_A);
    const txInsert = vi.fn().mockResolvedValue(created);
    mockTransaction.mockImplementationOnce(
      (fn: (tx: { promptTemplate: typeof mockRepo }) => Promise<AiPromptTemplate>) =>
        fn({ promptTemplate: { ...mockRepo, countByUser: vi.fn().mockResolvedValue(1), insert: txInsert } }),
    );

    const result = await createPromptTemplateAction(makeCreateFormData());

    expect(result.ok).toBe(true);
    const [insertInput] = txInsert.mock.calls[0] as [
      { is_default: boolean },
    ];
    expect(insertInput.is_default).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// freeform (自由記述) バリデーション
// ---------------------------------------------------------------------------

describe("freeform テンプレートのバリデーション", () => {
  it("freeform body で正常に作成できる({ASSIGNED_SALES} なしでも可)", async () => {
    const created = makeTemplateRow({ name: "自由記述テンプレ" });
    mockGetCurrentSession.mockResolvedValue(SESSION_A);
    const txInsert = vi.fn().mockResolvedValue(created);
    mockTransaction.mockImplementationOnce(
      (fn: (tx: { promptTemplate: typeof mockRepo }) => Promise<AiPromptTemplate>) =>
        fn({ promptTemplate: { ...mockRepo, countByUser: vi.fn().mockResolvedValue(1), insert: txInsert } }),
    );

    const result = await createPromptTemplateAction(
      makeCreateFormData({ body: serializeFreeform("丁寧なトーンで分析してください") }),
    );

    expect(result.ok).toBe(true);
    // 正規化済み freeform body が insert される
    const [insertInput] = txInsert.mock.calls[0] as [{ body: string }];
    expect(JSON.parse(insertInput.body)).toEqual({
      kind: "freeform",
      text: "丁寧なトーンで分析してください",
    });
  });

  it("freeform body が空文字なら failure", async () => {
    mockGetCurrentSession.mockResolvedValue(SESSION_A);
    const result = await createPromptTemplateAction(
      makeCreateFormData({ body: serializeFreeform("   ") }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/本文を入力/);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("freeform body が上限超過なら failure", async () => {
    mockGetCurrentSession.mockResolvedValue(SESSION_A);
    const tooLong = "あ".repeat(MAX_FREEFORM_LENGTH + 1);
    const result = await createPromptTemplateAction(
      makeCreateFormData({ body: serializeFreeform(tooLong) }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/文字以内/);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("freeform body で更新できる", async () => {
    const updated = makeTemplateRow({ name: "更新" });
    mockGetCurrentSession.mockResolvedValue(SESSION_A);
    mockRepo.update.mockResolvedValue(updated);

    const result = await updatePromptTemplateAction(
      makeUpdateFormData({ body: serializeFreeform("更新後の自由記述") }),
    );

    expect(result.ok).toBe(true);
    const [, , patch] = mockRepo.update.mock.calls[0] as [
      string,
      string,
      { body: string },
    ];
    expect(JSON.parse(patch.body)).toEqual({
      kind: "freeform",
      text: "更新後の自由記述",
    });
  });
});

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

describe("updatePromptTemplateAction", () => {
  it("正常に更新できる", async () => {
    const updated = makeTemplateRow({ name: "更新テンプレート" });
    mockGetCurrentSession.mockResolvedValue(SESSION_A);
    mockRepo.update.mockResolvedValue(updated);

    const result = await updatePromptTemplateAction(makeUpdateFormData());

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.name).toBe("更新テンプレート");
    expect(mockRepo.update).toHaveBeenCalledWith(
      TEMPLATE_ID,
      USER_A,
      expect.objectContaining({ name: "更新テンプレート" }),
    );
  });

  it("他ユーザー / 存在しない id なら failure", async () => {
    mockGetCurrentSession.mockResolvedValue(SESSION_A);
    mockRepo.update.mockResolvedValue(null);

    const result = await updatePromptTemplateAction(
      makeUpdateFormData({ id: "nonexistent" }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/見つかりません/);
  });

  it("patch に is_default を含まない", async () => {
    const updated = makeTemplateRow();
    mockGetCurrentSession.mockResolvedValue(SESSION_A);
    mockRepo.update.mockResolvedValue(updated);

    await updatePromptTemplateAction(makeUpdateFormData());

    const [, , patch] = mockRepo.update.mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(patch).not.toHaveProperty("is_default");
  });

  it("不正 body なら failure", async () => {
    mockGetCurrentSession.mockResolvedValue(SESSION_A);
    const result = await updatePromptTemplateAction(
      makeUpdateFormData({ body: "{bad json}" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/不正/);
    expect(mockRepo.update).not.toHaveBeenCalled();
  });

  it("id が不正UUID なら failure を返し、repo.update を呼ばない", async () => {
    mockGetCurrentSession.mockResolvedValue(SESSION_A);

    const result = await updatePromptTemplateAction(
      makeUpdateFormData({ id: "not-a-uuid" }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/見つかりません/);
    expect(mockRepo.update).not.toHaveBeenCalled();
  });

  it("前後空白つき name は trim されて update される", async () => {
    const updated = makeTemplateRow({ name: "更新後" });
    mockGetCurrentSession.mockResolvedValue(SESSION_A);
    mockRepo.update.mockResolvedValue(updated);

    await updatePromptTemplateAction(makeUpdateFormData({ name: "  更新後  " }));

    const [, , patch] = mockRepo.update.mock.calls[0] as [
      string,
      string,
      { name: string },
    ];
    expect(patch.name).toBe("更新後");
  });
});

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

describe("deletePromptTemplateAction", () => {
  it("正常に削除できる", async () => {
    mockGetCurrentSession.mockResolvedValue(SESSION_A);
    mockRepo.findById.mockResolvedValue(makeTemplateRow({ is_default: false }));
    mockRepo.delete.mockResolvedValue(true);

    const result = await deletePromptTemplateAction(TEMPLATE_ID);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBe(true);
    expect(mockRepo.delete).toHaveBeenCalledWith(TEMPLATE_ID, USER_A);
  });

  it("デフォルトテンプレートは削除拒否", async () => {
    mockGetCurrentSession.mockResolvedValue(SESSION_A);
    mockRepo.findById.mockResolvedValue(makeTemplateRow({ is_default: true }));

    const result = await deletePromptTemplateAction(TEMPLATE_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/デフォルト/);
    expect(mockRepo.delete).not.toHaveBeenCalled();
  });

  it("存在しない id なら failure", async () => {
    mockGetCurrentSession.mockResolvedValue(SESSION_A);
    mockRepo.findById.mockResolvedValue(null);

    const result = await deletePromptTemplateAction("nonexistent");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/見つかりません/);
    expect(mockRepo.delete).not.toHaveBeenCalled();
  });

  it("id が不正UUID なら failure を返し、repo.findById / repo.delete を呼ばない", async () => {
    mockGetCurrentSession.mockResolvedValue(SESSION_A);

    const result = await deletePromptTemplateAction("not-a-uuid");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/見つかりません/);
    expect(mockRepo.findById).not.toHaveBeenCalled();
    expect(mockRepo.delete).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// setDefault
// ---------------------------------------------------------------------------

describe("setDefaultPromptTemplateAction", () => {
  it("正常にデフォルトを切り替えられ、repos.transaction() が呼ばれる", async () => {
    const existing = makeTemplateRow({ is_default: false });
    const updated = makeTemplateRow({ is_default: true });
    mockGetCurrentSession.mockResolvedValue(SESSION_A);
    mockRepo.findById.mockResolvedValue(existing);

    const mockTxSetDefault = vi.fn().mockResolvedValue(updated);
    mockTransaction.mockImplementationOnce(
      (fn: (tx: { promptTemplate: { setDefault: typeof mockTxSetDefault } }) => Promise<AiPromptTemplate | null>) =>
        fn({ promptTemplate: { setDefault: mockTxSetDefault } }),
    );

    const result = await setDefaultPromptTemplateAction(TEMPLATE_ID);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.is_default).toBe(true);
      expect(result.data.id).toBe(TEMPLATE_ID);
    }
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockTxSetDefault).toHaveBeenCalledWith(TEMPLATE_ID, USER_A);
  });

  it("存在しない id なら failure (transaction 未呼び出し)", async () => {
    mockGetCurrentSession.mockResolvedValue(SESSION_A);
    mockRepo.findById.mockResolvedValue(null);

    const result = await setDefaultPromptTemplateAction("nonexistent");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/見つかりません/);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("他ユーザーの id なら failure (findById が null → transaction 未呼び出し)", async () => {
    // USER_B で検索すると findById は null を返す (userId 条件でフィルタ済)
    mockGetCurrentSession.mockResolvedValue({ userId: USER_B, email: "b@test.com" });
    mockRepo.findById.mockResolvedValue(null);

    const result = await setDefaultPromptTemplateAction(TEMPLATE_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/見つかりません/);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("id が不正UUID なら failure を返し、repo.findById / repos.transaction を呼ばない", async () => {
    mockGetCurrentSession.mockResolvedValue(SESSION_A);

    const result = await setDefaultPromptTemplateAction("not-a-uuid");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/見つかりません/);
    expect(mockRepo.findById).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("transaction 内部でエラーが発生した場合は failure", async () => {
    const existing = makeTemplateRow();
    mockGetCurrentSession.mockResolvedValue(SESSION_A);
    mockRepo.findById.mockResolvedValue(existing);
    mockTransaction.mockRejectedValueOnce(new Error("DB error"));

    const result = await setDefaultPromptTemplateAction(TEMPLATE_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/変更できません/);
  });
});
