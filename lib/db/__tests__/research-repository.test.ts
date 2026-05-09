/**
 * makeResearchRepo の単体テスト。
 *
 * 役割:
 * - `lib/db/research-repository.ts` の `makeResearchRepo` ファクトリが返す
 *   `ResearchRepository` 各メソッドが、期待どおりの Drizzle チェーン
 *   (`select / from / where / limit / orderBy / insert / values / update /
 *    set / delete / returning`) を発行することを保証する。
 * - 1 店舗 1 調査セマンティクス (`getByStoreId().limit(1)`) が破られていない
 *   ことを P0 リグレッション網として固定する。
 * - 実 DB 接続は使用しない。`vi.fn().mockReturnValue(chain)` で
 *   チェイナブル / Thenable な mock executor を作る。
 *
 * 関連: research-handoff-db-migration design.md §「Testing Strategy / Unit Tests」、
 *       requirements.md §1.1 §1.4 §2.1〜2.5 §9.5 §10.1 §10.2、Critical Issue #1
 *       (1:1 race window — DB UNIQUE 不採用、Action 層 + getByStoreId.limit(1) で担保)
 */

import { describe, expect, it, vi } from "vitest";
import type { Research, ResearchInput } from "@/types/research";

// `lib/db/client.ts` は top-level で `assertEnv("DATABASE_URL")` を発火するため、
// 単体テスト環境(env 未設定)では import だけで失敗する。実 DB 接続は使用せず
// `dbResearchRepo` の評価のみを成立させるためにダミー化する。
// `makeResearchRepo` は executor を closure に保持するだけなので空オブジェクトで十分。
vi.mock("@/lib/db/client", () => ({
  db: {},
  sql: {},
}));

const { makeResearchRepo } = await import("../research-repository");

/**
 * チェイナブルかつ Thenable な mock executor。
 *
 * - すべての Drizzle クエリビルダーメソッド (`select / from / where / limit /
 *   orderBy / insert / values / update / set / delete / returning /
 *   onConflictDoUpdate`) を `vi.fn` で記録し、各呼び出しの引数を保持する。
 * - 各メソッドは `chain` 自身を返すため `await chain.method().method()...` の
 *   連鎖が型レベルで動作する。
 * - `then(resolve)` で `rows` を解決値として返す Thenable 化により、`await` 時に
 *   設定済みのモックデータが取り出される。
 */
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
  // Thenable: `await chain` で設定済み rows を解決
  chain.then = (resolve: (value: unknown) => void) => resolve(rows);
  return chain as Record<(typeof methods)[number], ReturnType<typeof vi.fn>> &
    PromiseLike<unknown>;
}

const SAMPLE_INPUT: ResearchInput = {
  store_id: "store_001",
  store_name: "導楽",
  total_review: "食べログ3.4 / 12件",
  strength1: "刺し盛にくじら",
  strength2: "日本酒",
  strength3: "常連客",
  weakness1: "HP なし",
  weakness2: "返信ゼロ",
  weakness3: "コスパ不満",
  review_positive: "+",
  review_negative: "-",
  meo_gap: "写真不足",
  hp_gap: "未開設",
  instagram_gap: "未開設",
  channel: "テレアポ推奨",
  channel_reason: "電話のみ",
  sales_hook: "情報発信を強化",
  entry_product: "MEO",
  main_product: "HP制作",
  researcher: "佐藤",
  status: "完了",
};

describe("makeResearchRepo", () => {
  describe("list()", () => {
    it("select → from → orderBy のチェーンを発行する", async () => {
      const exec = createChainable([]);
      const repo = makeResearchRepo(exec as never);
      await repo.list();
      expect(exec.select).toHaveBeenCalledOnce();
      expect(exec.from).toHaveBeenCalledOnce();
      expect(exec.orderBy).toHaveBeenCalledOnce();
    });

    it("rows 配列をそのまま返す", async () => {
      const sampleRow = { id: "res_001", store_id: "store_001" } as Research;
      const exec = createChainable([sampleRow]);
      const repo = makeResearchRepo(exec as never);
      const result = await repo.list();
      expect(result).toEqual([sampleRow]);
    });
  });

  describe("get(id)", () => {
    it("select + where + limit(1) を発行する", async () => {
      const exec = createChainable([]);
      const repo = makeResearchRepo(exec as never);
      await repo.get("res_001");
      expect(exec.where).toHaveBeenCalledOnce();
      expect(exec.limit).toHaveBeenCalledWith(1);
    });

    it("rows が空のとき null を返す", async () => {
      const exec = createChainable([]);
      const repo = makeResearchRepo(exec as never);
      const result = await repo.get("res_999");
      expect(result).toBeNull();
    });

    it("rows[0] を返す", async () => {
      const sampleRow = { id: "res_001" } as Research;
      const exec = createChainable([sampleRow]);
      const repo = makeResearchRepo(exec as never);
      const result = await repo.get("res_001");
      expect(result).toBe(sampleRow);
    });
  });

  describe("getByStoreId(storeId) — 1:1 セマンティクス (P0)", () => {
    it("limit(1) を必ず含むチェーンを発行する (1:1 enforcement)", async () => {
      const exec = createChainable([]);
      const repo = makeResearchRepo(exec as never);
      await repo.getByStoreId("store_001");
      expect(exec.limit).toHaveBeenCalledWith(1);
    });

    it("複数件存在しても先頭の 1 件のみを返す", async () => {
      const r1 = { id: "res_001" } as Research;
      const r2 = { id: "res_002" } as Research;
      const exec = createChainable([r1, r2]);
      const repo = makeResearchRepo(exec as never);
      const result = await repo.getByStoreId("store_001");
      expect(result).toBe(r1);
    });

    it("該当無しのとき null を返す", async () => {
      const exec = createChainable([]);
      const repo = makeResearchRepo(exec as never);
      const result = await repo.getByStoreId("store_999");
      expect(result).toBeNull();
    });
  });

  describe("create(input)", () => {
    it("insert + values チェーンを発行する", async () => {
      const exec = createChainable([]);
      const repo = makeResearchRepo(exec as never);
      await repo.create(SAMPLE_INPUT);
      expect(exec.insert).toHaveBeenCalledOnce();
      expect(exec.values).toHaveBeenCalledOnce();
    });

    it("ID は `res_` プレフィックス付きで自動発番される", async () => {
      const exec = createChainable([]);
      const repo = makeResearchRepo(exec as never);
      const result = await repo.create(SAMPLE_INPUT);
      expect(result.id).toMatch(/^res_/);
    });

    it("created_at / updated_at は YYYY-MM-DD 形式の text", async () => {
      const exec = createChainable([]);
      const repo = makeResearchRepo(exec as never);
      const result = await repo.create(SAMPLE_INPUT);
      expect(result.created_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(result.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(result.created_at).toBe(result.updated_at);
    });

    it("入力フィールドが返り値にそのまま反映される", async () => {
      const exec = createChainable([]);
      const repo = makeResearchRepo(exec as never);
      const result = await repo.create(SAMPLE_INPUT);
      expect(result.store_id).toBe(SAMPLE_INPUT.store_id);
      expect(result.channel).toBe(SAMPLE_INPUT.channel);
      expect(result.researcher).toBe(SAMPLE_INPUT.researcher);
    });
  });

  describe("update(id, patch)", () => {
    it("既存レコードがあれば update + set + where を発行する", async () => {
      const existing = {
        id: "res_001",
        ...SAMPLE_INPUT,
        created_at: "2026-05-01",
        updated_at: "2026-05-01",
      } as Research;
      const exec = createChainable([existing]);
      const repo = makeResearchRepo(exec as never);
      const result = await repo.update("res_001", { researcher: "渡部" });
      expect(exec.update).toHaveBeenCalledOnce();
      expect(exec.set).toHaveBeenCalledOnce();
      expect(result?.researcher).toBe("渡部");
    });

    it("existing に patch をマージして返す", async () => {
      const existing = {
        id: "res_001",
        ...SAMPLE_INPUT,
        created_at: "2026-05-01",
        updated_at: "2026-05-01",
      } as Research;
      const exec = createChainable([existing]);
      const repo = makeResearchRepo(exec as never);
      const result = await repo.update("res_001", { strength1: "新しい強み" });
      expect(result?.strength1).toBe("新しい強み");
      expect(result?.strength2).toBe(SAMPLE_INPUT.strength2);
    });

    it("未存在 ID では null を返す", async () => {
      const exec = createChainable([]);
      const repo = makeResearchRepo(exec as never);
      const result = await repo.update("res_999", { researcher: "x" });
      expect(result).toBeNull();
    });
  });

  describe("delete(id)", () => {
    it("delete + where + returning({ id }) を発行する", async () => {
      const exec = createChainable([{ id: "res_001" }]);
      const repo = makeResearchRepo(exec as never);
      await repo.delete("res_001");
      expect(exec.delete).toHaveBeenCalledOnce();
      expect(exec.where).toHaveBeenCalledOnce();
      expect(exec.returning).toHaveBeenCalledOnce();
    });

    it("returning が空配列のとき false を返す", async () => {
      const exec = createChainable([]);
      const repo = makeResearchRepo(exec as never);
      const result = await repo.delete("res_999");
      expect(result).toBe(false);
    });

    it("returning が 1 件以上のとき true を返す", async () => {
      const exec = createChainable([{ id: "res_001" }]);
      const repo = makeResearchRepo(exec as never);
      const result = await repo.delete("res_001");
      expect(result).toBe(true);
    });
  });
});
