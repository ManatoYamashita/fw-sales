/**
 * makeStoreRepo(...).getDeleteImpact のユニットテスト (#152 store-cascade-delete)。
 *
 * テスト方針 (place-candidate-repository.test.ts と同様):
 * - `@/lib/db/client` をモックして実 DB 接続を防ぐ
 * - executor.execute をモックし、単一 SELECT (スカラーサブクエリ ×4) の結果行を返す
 * - 「空配列は DB へ問い合わせない」「1 往復で取得する」という契約
 *   (design.md §StoreRepository.getDeleteImpact) を検証する
 *
 * Issue #229: 戻り値のマッピングだけを見ていると「サブクエリを書き忘れたまま
 * マッピングだけ足す」実装が常に 0 を返すのに green になる (型はキーの存在しか
 * 強制しない)。これを塞ぐため、発行される SQL 自体を PgDialect で実コンパイルして
 * 検証するケースを持つ (find-area-search-candidates.test.ts の手法を踏襲)。
 * 期待する子テーブル集合は schema.ts のメタデータから導出する — 直値で固定すると
 * 「今の 4 本」を写しただけの snapshot になり、5 本目が増えたときに同じ書き忘れを
 * 素通ししてしまう。
 */

import { describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { collectStoreChildForeignKeys } from "../store-child-fks";

vi.mock("@/lib/db/client", () => ({
  db: {},
}));

import { makeStoreRepo } from "../store-repository";
import type { DbClient } from "@/lib/db/client";

function makeExecutor(rows: Array<Record<string, unknown>>) {
  let capturedQuery: SQL | undefined;
  const execute = vi.fn((query: SQL) => {
    capturedQuery = query;
    return Promise.resolve(rows);
  });
  const executor = { execute } as unknown as DbClient;
  return {
    execute,
    executor,
    compiledQuery() {
      expect(capturedQuery).toBeDefined();
      return new PgDialect().sqlToQuery(capturedQuery!);
    },
  };
}

function normalizedSql(sql: string) {
  return sql.replace(/\s+/g, " ").toLowerCase();
}

describe("getDeleteImpact", () => {
  it("空配列は DB へ問い合わせず全カテゴリ 0 を返す", async () => {
    const { execute, executor } = makeExecutor([]);
    const repo = makeStoreRepo(executor);

    await expect(repo.getDeleteImpact([])).resolves.toEqual({
      deals: 0,
      store_research_runs: 0,
      handoffs: 0,
      place_candidates: 0,
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("単一クエリ (1 往復) の結果行をカテゴリ別件数へマッピングする", async () => {
    const { execute, executor } = makeExecutor([
      { deals: 3, store_research_runs: 22, handoffs: 1, place_candidates: 4 },
    ]);
    const repo = makeStoreRepo(executor);

    await expect(
      repo.getDeleteImpact(["store_a", "store_b"]),
    ).resolves.toEqual({
      deals: 3,
      store_research_runs: 22,
      handoffs: 1,
      place_candidates: 4,
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("結果行が欠落した場合は防御的に全カテゴリ 0 を返す", async () => {
    const { execute, executor } = makeExecutor([]);
    const repo = makeStoreRepo(executor);

    await expect(repo.getDeleteImpact(["store_a"])).resolves.toEqual({
      deals: 0,
      store_research_runs: 0,
      handoffs: 0,
      place_candidates: 0,
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("driver 差異 (bigint / 文字列 / null) の count も number へ正規化する", async () => {
    const { executor } = makeExecutor([
      {
        deals: "5",
        store_research_runs: "7",
        handoffs: BigInt(2),
        place_candidates: null,
      },
    ]);
    const repo = makeStoreRepo(executor);

    await expect(repo.getDeleteImpact(["store_a"])).resolves.toEqual({
      deals: 5,
      store_research_runs: 7,
      handoffs: 2,
      place_candidates: 0,
    });
  });

  it("stores を参照する子テーブルすべてを 1 文で数える SQL を発行する", async () => {
    // マッピングだけ足してサブクエリを忘れると常に 0 が返る。型では守れないため
    // 発行 SQL を実コンパイルして、カテゴリごとに count と別名が存在することを見る。
    const { executor, compiledQuery } = makeExecutor([
      { deals: 0, store_research_runs: 0, handoffs: 0, place_candidates: 0 },
    ]);
    const repo = makeStoreRepo(executor);
    const ids = ["store_a", "store_b"];
    await repo.getDeleteImpact(ids);

    const query = compiledQuery();
    const sql = normalizedSql(query.sql);

    // 期待集合は schema.ts の FK 実態から導出する。直値配列にすると、子テーブルが
    // 増えたときに本ケースが「更新すべき snapshot」へ退化し、新カテゴリの
    // サブクエリ欠落 (= 常に 0 件表示) を検出できなくなる。
    const storeChildFks = collectStoreChildForeignKeys();
    expect(storeChildFks.length, "stores 参照 FK を 1 本も列挙できていない").toBeGreaterThan(0);

    for (const { child, column } of storeChildFks) {
      // 別名は「StoreDeleteImpact のキー = 子テーブル名」規約に従う
      // (規約自体は store-cascade-fk-coverage.test.ts が機械検証する)。
      expect(sql, `${child} のサブクエリが無い`).toContain(`from "${child}"`);
      expect(sql, `${child} の絞り込み列が違う`).toContain(`"${child}"."${column}"`);
      expect(sql, `${child} の別名が無い`).toContain(`as ${child}`);
    }
    expect(
      (sql.match(/count\(\*\)/g) ?? []).length,
      "count(*) の本数が stores 参照 FK の本数と一致しない",
    ).toBe(storeChildFks.length);

    // ID 群は inArray で子テーブルの本数ぶん展開される (sql テンプレートへの直埋めは
    // `any(($1))` の不正 SQL になるため禁止 / store-repository.ts のコメント参照)。
    expect(query.params).toEqual(storeChildFks.flatMap(() => ids));
  });
});
