/**
 * makeStoreRepo(...).getDeleteImpact のユニットテスト (#152 store-cascade-delete)。
 *
 * テスト方針 (place-candidate-repository.test.ts と同様):
 * - `@/lib/db/client` をモックして実 DB 接続を防ぐ
 * - executor.execute をモックし、単一 SELECT (スカラーサブクエリ ×3) の結果行を返す
 * - 「空配列は DB へ問い合わせない」「1 往復で取得する」という契約
 *   (design.md §StoreRepository.getDeleteImpact) を検証する
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/client", () => ({
  db: {},
}));

import { makeStoreRepo } from "../store-repository";
import type { DbClient } from "@/lib/db/client";

function makeExecutor(rows: Array<Record<string, unknown>>) {
  const execute = vi.fn().mockResolvedValue(rows);
  const executor = { execute } as unknown as DbClient;
  return { execute, executor };
}

describe("getDeleteImpact", () => {
  it("空配列は DB へ問い合わせず全カテゴリ 0 を返す", async () => {
    const { execute, executor } = makeExecutor([]);
    const repo = makeStoreRepo(executor);

    await expect(repo.getDeleteImpact([])).resolves.toEqual({
      deals: 0,
      handoffs: 0,
      place_candidates: 0,
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("単一クエリ (1 往復) の結果行をカテゴリ別件数へマッピングする", async () => {
    const { execute, executor } = makeExecutor([
      { deals: 3, handoffs: 1, place_candidates: 4 },
    ]);
    const repo = makeStoreRepo(executor);

    await expect(
      repo.getDeleteImpact(["store_a", "store_b"]),
    ).resolves.toEqual({
      deals: 3,
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
      handoffs: 0,
      place_candidates: 0,
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("driver 差異 (bigint / 文字列 / null) の count も number へ正規化する", async () => {
    const { executor } = makeExecutor([
      {
        deals: "5",
        handoffs: BigInt(2),
        place_candidates: null,
      },
    ]);
    const repo = makeStoreRepo(executor);

    await expect(repo.getDeleteImpact(["store_a"])).resolves.toEqual({
      deals: 5,
      handoffs: 2,
      place_candidates: 0,
    });
  });
});
