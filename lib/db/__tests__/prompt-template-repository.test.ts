/**
 * makePromptTemplateRepo のユニットテスト (Issue #42)
 *
 * テスト方針:
 * - `@/lib/db/client` をモックして実 DB 接続を防ぐ
 * - Drizzle query builder を Proxy-based mock executor で代替する
 * - makePromptTemplateRepo(mockExecutor) を使い、dbPromptTemplateRepo は使わない
 * - DB の実際のクエリ内容ではなく、repository の戻り値 / ふるまいを検証する
 *
 * 詳細バリデーション (最大5件・4000字超) は Phase 2 の Server Actions 側で実装するため
 * 本テストの対象外とする。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// DB クライアントをモック: assertEnv("DATABASE_URL") による throw を防ぐ
vi.mock("@/lib/db/client", () => ({
  db: {},
}));

import { makePromptTemplateRepo } from "../prompt-template-repository";
import type { AiPromptTemplate } from "@/types/ai-prompt-template";
import type { DbClient } from "@/lib/db/client";

// ---------------------------------------------------------------------------
// Proxy-based mock executor
//
// Drizzle の fluent query builder (select().from().where().limit() ...) を模倣する。
// すべてのメソッド呼び出しは新しい Proxy を返し、await 時に `terminal` 値に解決する。
// これにより実際の SQL を生成せずに repository の戻り値ロジックをテストできる。
// ---------------------------------------------------------------------------

type TerminalValue = unknown[] | { count: number }[];

function makeQueryProxy(terminal: TerminalValue): object {
  const handler: ProxyHandler<object> = {
    get(_target, prop: string | symbol) {
      // await 時に呼ばれる Promise.then 互換
      if (prop === "then") {
        return (
          onFulfilled: (v: TerminalValue) => unknown,
          onRejected?: (e: unknown) => unknown,
        ) => Promise.resolve(terminal).then(onFulfilled, onRejected);
      }
      if (prop === "catch") {
        return (onRejected: (e: unknown) => unknown) =>
          Promise.resolve(terminal).catch(onRejected);
      }
      if (prop === "finally") {
        return (onFinally: () => void) =>
          Promise.resolve(terminal).finally(onFinally);
      }
      // その他すべてのメソッド呼び出しは同じ terminal を持つ新しい Proxy を返す
      return () => new Proxy({}, handler);
    },
  };
  return new Proxy({}, handler);
}

type MockExecutorConfig = {
  selectRows?: unknown[];
  insertRows?: unknown[];
  updateRows?: unknown[];
  deleteRows?: unknown[];
};

function makeMockExecutor(config: MockExecutorConfig = {}) {
  return {
    select: vi.fn().mockReturnValue(makeQueryProxy(config.selectRows ?? [])),
    insert: vi.fn().mockReturnValue(makeQueryProxy(config.insertRows ?? [])),
    update: vi.fn().mockReturnValue(makeQueryProxy(config.updateRows ?? [])),
    delete: vi.fn().mockReturnValue(makeQueryProxy(config.deleteRows ?? [])),
  };
}

// ---------------------------------------------------------------------------
// テストデータ
// ---------------------------------------------------------------------------

const USER_A = "user-uuid-a";
const USER_B = "user-uuid-b";
const TEMPLATE_ID = "template-uuid-1";

function makeTemplateRow(
  overrides: Partial<AiPromptTemplate> = {},
): AiPromptTemplate {
  return {
    id: TEMPLATE_ID,
    user_id: USER_A,
    name: "テストテンプレート",
    is_default: false,
    body: '{"fewshots":[]}',
    created_at: "2026-05-24",
    updated_at: "2026-05-24",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// テスト
// ---------------------------------------------------------------------------

describe("makePromptTemplateRepo", () => {
  let executor: ReturnType<typeof makeMockExecutor>;

  beforeEach(() => {
    executor = makeMockExecutor();
  });

  // -------------------------------------------------------------------------
  // list
  // -------------------------------------------------------------------------
  describe("list(userId)", () => {
    it("指定ユーザーのテンプレートを配列で返す", async () => {
      const rows = [makeTemplateRow(), makeTemplateRow({ id: "t2", name: "B" })];
      executor.select.mockReturnValue(makeQueryProxy(rows));
      const repo = makePromptTemplateRepo(executor as unknown as DbClient);

      const result = await repo.list(USER_A);

      expect(result).toHaveLength(2);
      expect(result[0]?.user_id).toBe(USER_A);
      expect(result[1]?.name).toBe("B");
    });

    it("テンプレートが 0 件の場合は空配列を返す", async () => {
      executor.select.mockReturnValue(makeQueryProxy([]));
      const repo = makePromptTemplateRepo(executor as unknown as DbClient);

      const result = await repo.list(USER_A);

      expect(result).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // findById
  // -------------------------------------------------------------------------
  describe("findById(id, userId)", () => {
    it("自分のテンプレートを返す", async () => {
      const row = makeTemplateRow();
      executor.select.mockReturnValue(makeQueryProxy([row]));
      const repo = makePromptTemplateRepo(executor as unknown as DbClient);

      const result = await repo.findById(TEMPLATE_ID, USER_A);

      expect(result).not.toBeNull();
      expect(result?.id).toBe(TEMPLATE_ID);
      expect(result?.user_id).toBe(USER_A);
    });

    it("userId 不一致 (他ユーザー) の場合は null を返す", async () => {
      // DB は userId 条件でフィルタするため行が返らない → 空配列
      executor.select.mockReturnValue(makeQueryProxy([]));
      const repo = makePromptTemplateRepo(executor as unknown as DbClient);

      const result = await repo.findById(TEMPLATE_ID, USER_B);

      expect(result).toBeNull();
    });

    it("対象 id が存在しない場合は null を返す", async () => {
      executor.select.mockReturnValue(makeQueryProxy([]));
      const repo = makePromptTemplateRepo(executor as unknown as DbClient);

      const result = await repo.findById("nonexistent-id", USER_A);

      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // insert
  // -------------------------------------------------------------------------
  describe("insert(input)", () => {
    it("新規テンプレートを挿入して返す", async () => {
      const created = makeTemplateRow({ name: "新規テンプレ" });
      executor.insert.mockReturnValue(makeQueryProxy([created]));
      const repo = makePromptTemplateRepo(executor as unknown as DbClient);

      const result = await repo.insert({
        user_id: USER_A,
        name: "新規テンプレ",
        is_default: false,
        body: '{"fewshots":[]}',
      });

      expect(result.name).toBe("新規テンプレ");
      expect(result.user_id).toBe(USER_A);
      expect(executor.insert).toHaveBeenCalledTimes(1);
    });

    it("insert が行を返さない場合は throw する", async () => {
      executor.insert.mockReturnValue(makeQueryProxy([]));
      const repo = makePromptTemplateRepo(executor as unknown as DbClient);

      await expect(
        repo.insert({
          user_id: USER_A,
          name: "fail",
          is_default: false,
          body: '{"fewshots":[]}',
        }),
      ).rejects.toThrow("insert returned no row");
    });
  });

  // -------------------------------------------------------------------------
  // update
  // -------------------------------------------------------------------------
  describe("update(id, userId, patch)", () => {
    it("自分のテンプレートを更新して返す", async () => {
      const updated = makeTemplateRow({ name: "更新後" });
      executor.update.mockReturnValue(makeQueryProxy([updated]));
      const repo = makePromptTemplateRepo(executor as unknown as DbClient);

      const result = await repo.update(TEMPLATE_ID, USER_A, { name: "更新後" });

      expect(result).not.toBeNull();
      expect(result?.name).toBe("更新後");
    });

    it("他ユーザーのテンプレートは更新しない (null を返す)", async () => {
      // DB は userId 条件でフィルタするため更新行なし
      executor.update.mockReturnValue(makeQueryProxy([]));
      const repo = makePromptTemplateRepo(executor as unknown as DbClient);

      const result = await repo.update(TEMPLATE_ID, USER_B, { name: "X" });

      expect(result).toBeNull();
    });

    it("対象 id が存在しない場合は null を返す", async () => {
      executor.update.mockReturnValue(makeQueryProxy([]));
      const repo = makePromptTemplateRepo(executor as unknown as DbClient);

      const result = await repo.update("nonexistent", USER_A, { name: "Y" });

      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // delete
  // -------------------------------------------------------------------------
  describe("delete(id, userId)", () => {
    it("自分のテンプレートを削除して true を返す", async () => {
      executor.delete.mockReturnValue(makeQueryProxy([{ id: TEMPLATE_ID }]));
      const repo = makePromptTemplateRepo(executor as unknown as DbClient);

      const result = await repo.delete(TEMPLATE_ID, USER_A);

      expect(result).toBe(true);
      expect(executor.delete).toHaveBeenCalledTimes(1);
    });

    it("他ユーザーのテンプレートは削除できず false を返す", async () => {
      // DB は userId 条件でフィルタするため削除行なし
      executor.delete.mockReturnValue(makeQueryProxy([]));
      const repo = makePromptTemplateRepo(executor as unknown as DbClient);

      const result = await repo.delete(TEMPLATE_ID, USER_B);

      expect(result).toBe(false);
    });

    it("対象 id が存在しない場合は false を返す", async () => {
      executor.delete.mockReturnValue(makeQueryProxy([]));
      const repo = makePromptTemplateRepo(executor as unknown as DbClient);

      const result = await repo.delete("nonexistent", USER_A);

      expect(result).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // countByUser
  // -------------------------------------------------------------------------
  describe("countByUser(userId)", () => {
    it("指定ユーザーのテンプレート件数を返す", async () => {
      executor.select.mockReturnValue(makeQueryProxy([{ count: 3 }]));
      const repo = makePromptTemplateRepo(executor as unknown as DbClient);

      const result = await repo.countByUser(USER_A);

      expect(result).toBe(3);
    });

    it("0 件の場合は 0 を返す", async () => {
      executor.select.mockReturnValue(makeQueryProxy([{ count: 0 }]));
      const repo = makePromptTemplateRepo(executor as unknown as DbClient);

      const result = await repo.countByUser(USER_A);

      expect(result).toBe(0);
    });

    it("select が空配列の場合は 0 にフォールバックする", async () => {
      executor.select.mockReturnValue(makeQueryProxy([]));
      const repo = makePromptTemplateRepo(executor as unknown as DbClient);

      const result = await repo.countByUser(USER_A);

      expect(result).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // clearDefaultForUser
  // -------------------------------------------------------------------------
  describe("clearDefaultForUser(userId)", () => {
    it("default=true の行だけを対象にして void を返す", async () => {
      executor.update.mockReturnValue(makeQueryProxy([]));
      const repo = makePromptTemplateRepo(executor as unknown as DbClient);

      const result = await repo.clearDefaultForUser(USER_A);

      expect(result).toBeUndefined();
      expect(executor.update).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // setDefault
  // -------------------------------------------------------------------------
  describe("setDefault(id, userId)", () => {
    it("指定テンプレートをデフォルトに設定して返す (非デフォルト→デフォルト)", async () => {
      const existingRow = makeTemplateRow({ is_default: false });
      const defaultRow = makeTemplateRow({ is_default: true });
      // Step 1: 存在確認 select → 行あり (is_default: false)
      executor.select.mockReturnValueOnce(makeQueryProxy([existingRow]));
      executor.update
        // Step 2: clearDefaultForUser (default=true の行のみ対象) → void
        .mockReturnValueOnce(makeQueryProxy([]))
        // Step 3: is_default: true に更新 → 更新済み行を返す
        .mockReturnValueOnce(makeQueryProxy([defaultRow]));
      const repo = makePromptTemplateRepo(executor as unknown as DbClient);

      const result = await repo.setDefault(TEMPLATE_ID, USER_A);

      expect(result).not.toBeNull();
      expect(result?.is_default).toBe(true);
      expect(result?.id).toBe(TEMPLATE_ID);
      // clearDefault + setDefault の update が 2 回呼ばれること
      expect(executor.update).toHaveBeenCalledTimes(2);
    });

    it("既にデフォルトのテンプレートに setDefault すると update を呼ばずにそのまま返す", async () => {
      const alreadyDefaultRow = makeTemplateRow({ is_default: true });
      // Step 1: 存在確認 select → is_default: true の行が返る
      executor.select.mockReturnValueOnce(makeQueryProxy([alreadyDefaultRow]));
      const repo = makePromptTemplateRepo(executor as unknown as DbClient);

      const result = await repo.setDefault(TEMPLATE_ID, USER_A);

      expect(result).not.toBeNull();
      expect(result?.is_default).toBe(true);
      expect(result?.id).toBe(TEMPLATE_ID);
      // clearDefault も setDefault も呼ばれないこと
      expect(executor.update).not.toHaveBeenCalled();
    });

    it("対象テンプレートが存在しない (他ユーザー) 場合は null を返す (旧挙動との互換検証)", async () => {
      // 新実装: select が空 → update は呼ばれない
      executor.select.mockReturnValue(makeQueryProxy([]));
      const repo = makePromptTemplateRepo(executor as unknown as DbClient);

      const result = await repo.setDefault(TEMPLATE_ID, USER_B);

      expect(result).toBeNull();
      expect(executor.update).not.toHaveBeenCalled();
    });

    it("存在しない id で setDefault しても既存 default が維持される (select が空 → update 未呼び出し)", async () => {
      // select で空配列 → 存在確認失敗 → update は一切呼ばれない
      executor.select.mockReturnValue(makeQueryProxy([]));
      const repo = makePromptTemplateRepo(executor as unknown as DbClient);

      const result = await repo.setDefault("nonexistent-id", USER_A);

      expect(result).toBeNull();
      expect(executor.update).not.toHaveBeenCalled();
    });

    it("他ユーザーの id で setDefault しても既存 default が維持される (select が空 → update 未呼び出し)", async () => {
      // USER_B の id を USER_A として検索 → select で空配列 → update は一切呼ばれない
      executor.select.mockReturnValue(makeQueryProxy([]));
      const repo = makePromptTemplateRepo(executor as unknown as DbClient);

      const result = await repo.setDefault(TEMPLATE_ID, USER_B);

      expect(result).toBeNull();
      expect(executor.update).not.toHaveBeenCalled();
    });
  });
});
