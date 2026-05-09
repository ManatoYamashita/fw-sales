/**
 * makeHandoffRepo の単体テスト。
 *
 * 役割:
 * - `lib/db/handoff-repository.ts` の `makeHandoffRepo` ファクトリが返す
 *   `HandoffRepository` 各メソッドが、期待どおりの Drizzle チェーンを発行する
 *   ことを保証する。
 * - `payment_confirmed: string | null` のラウンドトリップ(空文字 `""` は変換せず
 *   そのまま、`null` も `null` のまま往復)を P0 リグレッション網として固定する。
 * - 実 DB 接続は使用しない。`research-repository.test.ts` と同じ
 *   チェイナブル mock executor パターンを利用。
 *
 * 関連: research-handoff-db-migration design.md §「Testing Strategy / Unit Tests」、
 *       requirements.md §1.1 §1.4 §3.1〜3.7 §9.5 §10.1 §10.2 §10.3
 */

import { describe, expect, it, vi } from "vitest";
import type { Handoff, HandoffInput } from "@/types/handoff";

// `lib/db/client.ts` は top-level で `assertEnv("DATABASE_URL")` を発火するため、
// 単体テスト環境(env 未設定)では import だけで失敗する。`dbHandoffRepo` の
// 評価のみを成立させるためにダミー化する(executor は closure 保持のみで未使用)。
vi.mock("@/lib/db/client", () => ({
  db: {},
  sql: {},
}));

const { makeHandoffRepo } = await import("../handoff-repository");

function createChainable(rows: unknown[] = []) {
  const chain: Record<string, ReturnType<typeof vi.fn> | unknown> = {};
  const methods = [
    "select",
    "from",
    "where",
    "limit",
    "orderBy",
    "insert",
    "values",
    "update",
    "set",
    "delete",
    "returning",
    "onConflictDoUpdate",
  ] as const;
  for (const m of methods) {
    chain[m] = vi.fn(() => chain);
  }
  chain.then = (resolve: (value: unknown) => void) => resolve(rows);
  return chain as Record<(typeof methods)[number], ReturnType<typeof vi.fn>> &
    PromiseLike<unknown>;
}

const SAMPLE_INPUT: HandoffInput = {
  store_id: "store_005",
  store_name: "トラットリア SOLE",
  deal_id: "deal_002",
  contract_services: "HP制作 + MEO",
  initial_fee: 453000,
  monthly_fee: 22000,
  contract_period: "1年",
  expected_result: "新規来店月20件増",
  contract_owner: "佐藤(Firstweb)",
  caution: "オーナーは SNS 不慣れ",
  ng_items: "競合の名前出し NG",
  due_date: "2026-05-15",
  materials_status: "撮影2026-04-20",
  ops_assignee: "小泉",
  contract_date: "2026-05-09",
  payment_confirmed: null,
  status: "運用確認待ち",
};

describe("makeHandoffRepo", () => {
  describe("list()", () => {
    it("storeId 未指定で select → from → orderBy のチェーン (where なし)", async () => {
      const exec = createChainable([]);
      const repo = makeHandoffRepo(exec as never);
      await repo.list();
      expect(exec.select).toHaveBeenCalledOnce();
      expect(exec.from).toHaveBeenCalledOnce();
      expect(exec.orderBy).toHaveBeenCalledOnce();
      expect(exec.where).not.toHaveBeenCalled();
    });

    it("storeId 指定で where を 1 回追加し、orderBy も発行する", async () => {
      const exec = createChainable([]);
      const repo = makeHandoffRepo(exec as never);
      await repo.list("store_005");
      expect(exec.where).toHaveBeenCalledOnce();
      expect(exec.orderBy).toHaveBeenCalledOnce();
    });

    it("rows 配列をそのまま返す", async () => {
      const sampleRow = { id: "hand_001" } as Handoff;
      const exec = createChainable([sampleRow]);
      const repo = makeHandoffRepo(exec as never);
      const result = await repo.list();
      expect(result).toEqual([sampleRow]);
    });
  });

  describe("get(id)", () => {
    it("select + where + limit(1) を発行する", async () => {
      const exec = createChainable([]);
      const repo = makeHandoffRepo(exec as never);
      await repo.get("hand_001");
      expect(exec.where).toHaveBeenCalledOnce();
      expect(exec.limit).toHaveBeenCalledWith(1);
    });

    it("rows が空のとき null を返す", async () => {
      const exec = createChainable([]);
      const repo = makeHandoffRepo(exec as never);
      const result = await repo.get("hand_999");
      expect(result).toBeNull();
    });
  });

  describe("getByDealId(dealId) — 1:1 セマンティクス", () => {
    it("limit(1) を必ず含むチェーンを発行する", async () => {
      const exec = createChainable([]);
      const repo = makeHandoffRepo(exec as never);
      await repo.getByDealId("deal_002");
      expect(exec.limit).toHaveBeenCalledWith(1);
    });

    it("複数件存在しても先頭の 1 件のみを返す", async () => {
      const h1 = { id: "hand_001" } as Handoff;
      const h2 = { id: "hand_002" } as Handoff;
      const exec = createChainable([h1, h2]);
      const repo = makeHandoffRepo(exec as never);
      const result = await repo.getByDealId("deal_002");
      expect(result).toBe(h1);
    });
  });

  describe("create(input) — payment_confirmed nullable ラウンドトリップ", () => {
    it("insert + values チェーンを発行し、ID は `hand_` プレフィックス", async () => {
      const exec = createChainable([]);
      const repo = makeHandoffRepo(exec as never);
      const result = await repo.create(SAMPLE_INPUT);
      expect(exec.insert).toHaveBeenCalledOnce();
      expect(exec.values).toHaveBeenCalledOnce();
      expect(result.id).toMatch(/^hand_/);
    });

    it("payment_confirmed: null は変換せず values に渡される (P0)", async () => {
      const exec = createChainable([]);
      const repo = makeHandoffRepo(exec as never);
      const inputWithNullPayment: HandoffInput = {
        ...SAMPLE_INPUT,
        payment_confirmed: null,
      };
      await repo.create(inputWithNullPayment);
      const valuesArg = exec.values.mock.calls[0]?.[0] as Handoff;
      expect(valuesArg.payment_confirmed).toBeNull();
    });

    it("payment_confirmed: 文字列も変換せず values に渡される (空文字 → null 変換しない)", async () => {
      const exec = createChainable([]);
      const repo = makeHandoffRepo(exec as never);
      const inputWithEmpty: HandoffInput = {
        ...SAMPLE_INPUT,
        payment_confirmed: "",
      };
      await repo.create(inputWithEmpty);
      const valuesArg = exec.values.mock.calls[0]?.[0] as Handoff;
      // 空文字は Action 層で || null 化されるため Repository 層では空文字のまま
      expect(valuesArg.payment_confirmed).toBe("");
    });

    it("payment_confirmed: 日付文字列も変換せず values に渡される", async () => {
      const exec = createChainable([]);
      const repo = makeHandoffRepo(exec as never);
      const inputWithDate: HandoffInput = {
        ...SAMPLE_INPUT,
        payment_confirmed: "2026-05-09",
      };
      const result = await repo.create(inputWithDate);
      expect(result.payment_confirmed).toBe("2026-05-09");
    });

    it("created_at / updated_at は YYYY-MM-DD 形式", async () => {
      const exec = createChainable([]);
      const repo = makeHandoffRepo(exec as never);
      const result = await repo.create(SAMPLE_INPUT);
      expect(result.created_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(result.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("integer フィールド (initial_fee / monthly_fee) は数値として保持される", async () => {
      const exec = createChainable([]);
      const repo = makeHandoffRepo(exec as never);
      const result = await repo.create(SAMPLE_INPUT);
      expect(result.initial_fee).toBe(453000);
      expect(result.monthly_fee).toBe(22000);
      expect(typeof result.initial_fee).toBe("number");
    });
  });

  describe("update(id, patch)", () => {
    it("既存レコードがあれば update + set + where を発行する", async () => {
      const existing = {
        id: "hand_001",
        ...SAMPLE_INPUT,
        created_at: "2026-05-01",
        updated_at: "2026-05-01",
      } as Handoff;
      const exec = createChainable([existing]);
      const repo = makeHandoffRepo(exec as never);
      const result = await repo.update("hand_001", { status: "完了" });
      expect(exec.update).toHaveBeenCalledOnce();
      expect(exec.set).toHaveBeenCalledOnce();
      expect(result?.status).toBe("完了");
    });

    it("payment_confirmed: null の patch は null 値で渡される", async () => {
      const existing = {
        id: "hand_001",
        ...SAMPLE_INPUT,
        payment_confirmed: "2026-05-01",
        created_at: "2026-05-01",
        updated_at: "2026-05-01",
      } as Handoff;
      const exec = createChainable([existing]);
      const repo = makeHandoffRepo(exec as never);
      const result = await repo.update("hand_001", { payment_confirmed: null });
      expect(result?.payment_confirmed).toBeNull();
    });

    it("未存在 ID では null を返す", async () => {
      const exec = createChainable([]);
      const repo = makeHandoffRepo(exec as never);
      const result = await repo.update("hand_999", { status: "完了" });
      expect(result).toBeNull();
    });
  });

  describe("delete(id)", () => {
    it("delete + where + returning を発行する", async () => {
      const exec = createChainable([{ id: "hand_001" }]);
      const repo = makeHandoffRepo(exec as never);
      await repo.delete("hand_001");
      expect(exec.delete).toHaveBeenCalledOnce();
      expect(exec.where).toHaveBeenCalledOnce();
      expect(exec.returning).toHaveBeenCalledOnce();
    });

    it("returning が空配列のとき false を返す", async () => {
      const exec = createChainable([]);
      const repo = makeHandoffRepo(exec as never);
      const result = await repo.delete("hand_999");
      expect(result).toBe(false);
    });

    it("returning が 1 件以上のとき true を返す", async () => {
      const exec = createChainable([{ id: "hand_001" }]);
      const repo = makeHandoffRepo(exec as never);
      const result = await repo.delete("hand_001");
      expect(result).toBe(true);
    });
  });
});
