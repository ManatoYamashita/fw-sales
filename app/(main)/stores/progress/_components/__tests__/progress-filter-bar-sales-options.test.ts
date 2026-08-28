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
import {
  buildSalesOptions,
  triggerButtonClassName,
} from "../progress-filter-bar";
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

  it("クイックフィルタで表現できる条件は「適用中」チップに重複表示しない", () => {
    expect(code).toContain("const showSalesChip = Boolean(sales) && !isSalesSentinel(sales)");
    expect(code).toContain("const showNextChip = Boolean(next) && !isQuickTimingValue(next)");
    expect(code).toContain("{showNextChip ? (");
    expect(code).toContain("{showSalesChip ? (");
    // 無条件描画の旧実装へ戻っていないこと
    expect(code).not.toContain("{next ? (");
    expect(code).not.toContain("{sales ? (");
  });

  it("「適用中」行は表示できるチップが 1 つ以上あるときだけ出す", () => {
    expect(code).toContain("const hasAnyFilter = visibleChipCount > 0");
    // クイックフィルタで表現できない条件は必ず数に入れる
    expect(code).toContain("[q, state, appt, deal, stage, channel].filter(Boolean).length");
  });

  it("「すべて解除」は従来どおり全フィルタを消す (意味を変えない)", () => {
    expect(code).toContain("ALL_FILTER_KEYS.forEach((k) => nextParams.delete(k))");
    expect(code).toContain('nextParams.delete("sort")');
    expect(code).toContain('nextParams.delete("dir")');
    // sales / next も ALL_FILTER_KEYS に含まれ続けること
    // `[^\]]*` は改行も含むので dotAll フラグは不要。
    expect(code).toMatch(/ALL_FILTER_KEYS = \[[^\]]*"sales"[^\]]*\]/);
    expect(code).toMatch(/ALL_FILTER_KEYS = \[[^\]]*"next"[^\]]*\]/);
  });
});

/**
 * `cn` は素の clsx (tailwind-merge なし) なので、同じプロパティの**基底**
 * ユーティリティを 2 つ並べると class 属性に両方が残り、詳細度が同じため
 * 生成 CSS の記述順で勝敗が決まる。実際のビルド成果物では
 * `.text-foreground\/80` が `.text-background` より後ろにあり後者を打ち消すため、
 * 絞り込みボタンが active のとき「黒背景 + ほぼ黒の文字」= 文字とアイコンが
 * 見えない黒い長方形になっていた (Preview で報告された状態)。
 */
const COLOR_UTILITIES = [
  "text-foreground",
  "text-foreground/80",
  "text-background",
  "text-accent-foreground",
  "text-muted-foreground",
  "bg-foreground",
  "bg-background",
  "bg-accent",
  "bg-card",
  "bg-transparent",
];

/** 変種 (`hover:` 等) を除いた基底ユーティリティだけを返す。 */
function baseUtilities(className: string): string[] {
  return className
    .split(/\s+/)
    .filter(Boolean)
    .filter((c) => !c.includes(":"));
}

/** 同じ CSS プロパティを争う基底ユーティリティを列挙する。 */
function conflictingBaseColors(className: string, prefix: "text-" | "bg-") {
  return baseUtilities(className).filter(
    (c) => c.startsWith(prefix) && COLOR_UTILITIES.includes(c),
  );
}

describe("triggerButtonClassName (絞り込みボタン)", () => {
  it("active で文字色が背景色に打ち消されない (Preview の黒塗り回帰)", () => {
    const active = triggerButtonClassName(true);
    expect(active).toContain("bg-foreground");
    expect(active).toContain("text-background");
    // 基底の text-foreground/80 が残っていると後勝ちして文字が消える
    expect(baseUtilities(active)).not.toContain("text-foreground/80");
  });

  it("inactive は通常の文字色を持つ", () => {
    const inactive = triggerButtonClassName(false);
    expect(baseUtilities(inactive)).toContain("text-foreground/80");
    expect(baseUtilities(inactive)).not.toContain("text-background");
    expect(baseUtilities(inactive)).not.toContain("bg-foreground");
  });

  it.each([true, false])(
    "active=%s で基底の色ユーティリティが各プロパティ 1 つだけ",
    (active) => {
      const className = triggerButtonClassName(active);
      expect(conflictingBaseColors(className, "text-")).toHaveLength(1);
      expect(conflictingBaseColors(className, "bg-")).toHaveLength(1);
    },
  );

  it("検出ロジック自体が旧実装の class を不正と判定する", () => {
    // 修正前の TriggerButton が生成していた class 列。基底の text 色が 2 つ並び、
    // 生成 CSS の後勝ちで text-background が打ち消されていた。
    const legacy =
      "inline-flex h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-medium " +
      "border border-transparent hover:bg-accent text-foreground/80 hover:text-foreground " +
      "bg-foreground text-background border-foreground hover:bg-foreground/90";
    expect(conflictingBaseColors(legacy, "text-")).toEqual([
      "text-foreground/80",
      "text-background",
    ]);
    // 現行実装は同じ検出で 1 つに収まる
    expect(conflictingBaseColors(triggerButtonClassName(true), "text-")).toHaveLength(1);
  });

  it("フォーカスリングと枠線は状態によらず維持する", () => {
    for (const active of [true, false]) {
      const className = triggerButtonClassName(active);
      expect(className).toContain("focus-visible:ring-2");
      expect(className).toContain("border");
    }
  });
});

export { baseUtilities, conflictingBaseColors, COLOR_UTILITIES };
