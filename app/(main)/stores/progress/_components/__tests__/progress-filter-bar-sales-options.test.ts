/**
 * 営業担当 Select の選択肢 (`buildSalesOptions`) のユニットテスト。
 *
 * クイックフィルタが書く `?sales=me` / `?sales=none` を詳細フィルタの Select が
 * 表現できないと、「クイックフィルタでは『自分の担当』なのに、絞り込みを開くと
 * 何も選ばれていない」という食い違いが起きる (option が一致せずブラウザが
 * 先頭の『すべての担当』を表示してしまう)。
 *
 * 対象は Client Component から export された純関数。`store-delete-confirm-dialog.test.ts`
 * と同じく、描画を伴わない部分だけを直接テストする。
 */

import { beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildSalesOptions } from "../progress-filter-bar";
import {
  SALES_SENTINEL_VALUES,
  isSalesSentinel,
} from "../../../_components/store-quick-filter-params";

const PROFILES = [
  ["uuid-1", "山田"],
  ["uuid-2", "佐藤"],
] as const satisfies ReadonlyArray<readonly [string, string]>;

/** `<Select value={...}>` に一致する option があるか (= その状態を表現できるか)。 */
function optionFor(value: string) {
  return buildSalesOptions(PROFILES).find((o) => o.value === value);
}

describe("buildSalesOptions", () => {
  it("空値は従来どおり「すべての担当」", () => {
    expect(optionFor("")).toEqual({ value: "", label: "すべての担当" });
  });

  it("sales=me を「自分」として表現できる", () => {
    expect(optionFor("me")).toEqual({ value: "me", label: "自分" });
  });

  it("sales=none を「未割当」として表現できる", () => {
    expect(optionFor("none")).toEqual({ value: "none", label: "未割当" });
  });

  it("UUID 担当者の既存 option を維持する", () => {
    expect(optionFor("uuid-1")).toEqual({ value: "uuid-1", label: "山田" });
    expect(optionFor("uuid-2")).toEqual({ value: "uuid-2", label: "佐藤" });
  });

  it("すべての担当 → sentinel → 実担当者 の順で並べる", () => {
    expect(buildSalesOptions(PROFILES).map((o) => o.value)).toEqual([
      "",
      "me",
      "none",
      "uuid-1",
      "uuid-2",
    ]);
  });

  it("担当者が 0 人でも sentinel は選択できる", () => {
    expect(buildSalesOptions([]).map((o) => o.value)).toEqual(["", "me", "none"]);
  });

  it("value が重複しない (option の key / 一致判定が壊れない)", () => {
    const values = buildSalesOptions(PROFILES).map((o) => o.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it("すべての sentinel 値に option とラベルが存在する", () => {
    // sentinel を追加したのに Select へ載せ忘れる、を防ぐ。
    for (const sentinel of SALES_SENTINEL_VALUES) {
      const option = optionFor(sentinel);
      expect(option, `sentinel "${sentinel}" の option がない`).toBeDefined();
      expect(option?.label).toBeTruthy();
      expect(option?.label).not.toBe(sentinel);
    }
  });

  it("実担当者の UUID は sentinel と衝突しない", () => {
    for (const [id] of PROFILES) {
      expect(isSalesSentinel(id)).toBe(false);
    }
  });
});

describe("Select / チップへの配線", () => {
  let code: string;

  beforeAll(async () => {
    const source = await readFile(
      path.join(
        process.cwd(),
        "app/(main)/stores/progress/_components/progress-filter-bar.tsx",
      ),
      "utf8",
    );
    // 旧実装を説明する JSDoc への誤ヒットを避ける。
    code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  });

  it("営業担当 Select は buildSalesOptions の結果から option を描画する", () => {
    // profileEntries を直接 map する旧実装へ戻ると sentinel が選べなくなる。
    expect(code).toContain("{salesOptions.map(({ value, label }) => (");
    expect(code).not.toMatch(/<option value="">すべての担当<\/option>/);
  });

  it("適用中チップは Select と同じ配列からラベルを引く", () => {
    expect(code).toContain("labelOf(salesOptions, sales)");
  });

  it("sentinel 値を自前の文字列リテラルで再定義しない", () => {
    // 単一の真実は store-quick-filter-params.ts の SALES_SENTINEL_VALUES。
    expect(code).toContain("SALES_SENTINEL_VALUES");
  });
});
