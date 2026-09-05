/**
 * `DataTable` の「列単体予算 → 閾値」契約を 3 ビュー共通で検証するヘルパ
 * (Epic #225 Phase 2 の「各ビューの重複を解消」)。
 *
 * ## なぜ共有するのか
 *
 * `/stores` (#220 / #237)・`/dashboard` (#224)・`/handoffs` (#224) の列テストは、
 * 決定表 (`EXPECTED`) と予算表 (`BUDGET`) を**それぞれのビューが持つ**一方で、
 * 検証のロジックだけが逐語コピーになっていた (`visibleAt` は本体まで同一、
 * `NARROWEST_CONTAINER` も両方にあった)。決定表と予算表は「そのビューの意図」なので
 * ビュー側に残し、**検証ロジックだけをここへ集める**。
 *
 * ## なぜ「決定表」と別に予算からの累積を組み直すのか
 *
 * 決定表は閾値を写経しているだけなので、それ単体では **「cap や実測値を直したのに
 * 閾値を直し忘れた」事故を捕まえられない**。#224 は `/dashboard` で 3 段まとめて
 * 16px 不足させ、#237 は `/stores` で admin に 5 帯域の横スクロールを残した。
 * どちらも決定表は無傷のまま通っていた。
 *
 * **このガードが検出できるのは「予算と閾値の同期」だけで、実測値そのものの誤りは
 * 検出できない。** それはブラウザ計測の仕事 (Epic #225 の計測ハーネス) で、
 * 「cap を持つ列の予算は cap そのもの・アイコンを持つバッジはアイコン込み・
 * enum は最長値で測る」という規約とセットで初めて意味を持つ。
 *
 * ## 空洞化への備え
 *
 * この種のガードは「条件が一度も回らないまま green」になりやすい。
 * {@link expectBudgetLadder} は `always` と `ladder` が**全列を尽くすこと**と
 * `ladder` が空でないことを先に確かめてから累積へ入る。列を足して `ladder` へ
 * 積み忘れると、累積の検算が素通りする前にここで落ちる。
 */

import { expect } from "vitest";

/** 検証に必要な `ColumnDef` の部分形。ビューごとの行型に依存しないための最小面。 */
export interface ColumnBudgetInput {
  key: string;
  minContainerWidth?: number;
  maxWidth?: string;
}

/**
 * viewport 375px・サイドバー非表示のときのコンテナ幅。
 *
 * `375 − padding 32 − Card border 2 = 341`。Epic #225 の下限幅がここ。
 * サイドバーは 768px 未満では `fixed` のドロワーになり場所を取らない。
 */
export const NARROWEST_CONTAINER = 341;

/**
 * コンテナ幅 `width` で表示される列のキー。
 *
 * CSS 側は `@container (width < N)` で隠すので、表示条件は `width >= N`。
 * 閾値を持たない列 (always) は常に表示される。
 */
export function visibleAt(
  columns: readonly ColumnBudgetInput[],
  width: number,
): string[] {
  return columns
    .filter((c) => c.minContainerWidth === undefined || width >= c.minContainerWidth)
    .map((c) => c.key);
}

export interface BudgetLadderOptions {
  /** 検証対象の列定義。 */
  columns: readonly ColumnBudgetInput[];
  /** 列単体の予算 (px)。セル左右の padding を含む実効幅。 */
  budget: Readonly<Record<string, number>>;
  /** 常時表示する列。コンテナ幅によらず描画される。 */
  always: readonly string[];
  /** always の上に積む順 = 優先度の高い順。 */
  ladder: readonly string[];
  /** `always` の予算合計。写経ではなく、意図した値を明示するために受け取る。 */
  alwaysTotal: number;
  /**
   * 累積と閾値のズレを**列ごとに宣言する**ための逃し幅 (px)。
   *
   * 閾値は「列幅の丸め和」ではなく**テーブルの実 min-content** を採るのが正なので、
   * 両者が 1px ずれることがある (`/handoffs` の初期・月額がこれ。丸め和 717 に対し
   * 実 min-content は 718 で、717 だとその帯に 1px の横スクロールが残った)。
   *
   * **宣言していないズレは必ず失敗させる。** ここを「以上」で緩めると、予算を
   * 直し忘れた事故がすべて素通りするようになる。値は正 (= 閾値が累積より大きい =
   * 安全側) のみを許す。
   */
  slack?: Readonly<Record<string, number>>;
}

/**
 * 予算からの累積が `minContainerWidth` と厳密に一致することを検証する。
 *
 * 決定表とは**独立に**組み直すのが要点。決定表を参照してしまうと同じ写経を
 * 2 度見るだけになり、ガードとして機能しない。
 */
export function expectBudgetLadder({
  columns,
  budget,
  always,
  ladder,
  alwaysTotal,
  slack = {},
}: BudgetLadderOptions): void {
  const keys = columns.map((c) => c.key);
  const widthOf = (key: string) => {
    const found = columns.find((c) => c.key === key);
    expect(found, `列 ${key} が見つからない`).toBeDefined();
    return found!.minContainerWidth;
  };
  // 予算表に無いキーを黙って NaN に落とさない。抜けは事故なので明示的に失敗させる。
  const budgetOf = (key: string) => {
    const value = budget[key];
    expect(value, `列 ${key} の予算が BUDGET に無い`).toBeTypeOf("number");
    return value!;
  };

  // 1. always と ladder が全列を尽くす。取りこぼすと以下の検算が空洞になる。
  expect([...always, ...ladder].toSorted(), "always + ladder が全列を尽くしていない").toEqual(
    keys.toSorted(),
  );
  expect(ladder.length, "ladder が空だと累積の検算が 1 度も回らない").toBeGreaterThan(0);

  // 2. always 列は閾値を持たない (持っていたら always ではない)。
  for (const key of always) {
    expect(widthOf(key), `${key} は always なので閾値を持たないはず`).toBeUndefined();
  }

  // 3. always の予算合計が宣言と一致する。
  expect(
    always.reduce((sum, key) => sum + budgetOf(key), 0),
    "always 合計",
  ).toBe(alwaysTotal);

  // 4. ladder 順の累積が閾値と一致する (宣言した slack のぶんだけずれてよい)。
  let acc = alwaysTotal;
  for (const key of ladder) {
    acc += budgetOf(key);
    const extra = slack[key] ?? 0;
    expect(extra, `${key} の slack は安全側 (正) のみ許す`).toBeGreaterThanOrEqual(0);
    expect(widthOf(key), `${key} の閾値`).toBe(acc + extra);
    acc += extra;
  }
}

/**
 * cap (`maxWidth`) を持つ列は、その cap がそのまま予算であることを検証する。
 *
 * cap は「ここまで伸びうる」という宣言なので、いま入っているデータでの実測が
 * それを下回っても予算は縮まらない。片方だけ動かすと {@link expectBudgetLadder}
 * の累積が嘘になる (#237 で `/stores` の業態 cap 160 に対し予算 101 を採っていた)。
 */
export function expectCapsMatchBudget({
  columns,
  budget,
  capped,
}: {
  columns: readonly ColumnBudgetInput[];
  budget: Readonly<Record<string, number>>;
  capped: readonly string[];
}): void {
  expect(capped.length, "cap を持つ列が 1 つも無いのは想定外").toBeGreaterThan(0);

  for (const key of capped) {
    const found = columns.find((c) => c.key === key);
    expect(found, `列 ${key} が見つからない`).toBeDefined();
    const value = budget[key];
    expect(value, `列 ${key} の予算が BUDGET に無い`).toBeTypeOf("number");
    expect(found!.maxWidth, `${key} の cap`).toBe(`${value}px`);
  }

  // cap を宣言していない列が maxWidth を持っていたら、予算と cap の対応が漏れている。
  for (const c of columns) {
    if (capped.includes(c.key)) continue;
    expect(c.maxWidth, `${c.key} は capped に入っていないのに cap を持っている`).toBeUndefined();
  }
}
