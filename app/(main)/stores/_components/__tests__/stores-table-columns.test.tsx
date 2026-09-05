/**
 * 店舗一覧の列優先度 (#220 / PR2/3、#237 で予算を再測定) の配分を固定するテスト。
 *
 * 閾値は列単体の実測 min-content 幅の累計から決めており、1 列でも配分を変えると
 * その列以降の予算がまとめてずれる。ここで表を固定して、変更が「意図的な差分」
 * としてレビューに乗るようにする。
 *
 * 決定表 (EXPECTED) は閾値を写経しているだけなので、それ単体では「予算を直したのに
 * 閾値を直し忘れた」事故を捕まえられない。#237 で BUDGET からの累積を独立に組み直す
 * テストを足してある (/dashboard の recent-stores-table-columns.test.tsx と同じ形)。
 */

import { describe, expect, it, vi } from "vitest";
import {
  CARD_VIEW_BREAKPOINT,
  SELECTION_COLUMN_WIDTH,
  type ColumnMinContainerWidth,
} from "@/components/ui/data-table-responsive";
import {
  expectBudgetLadder,
  expectCapsMatchBudget,
} from "@/components/ui/__tests__/support/column-budget";

// 対象モジュールは Server Action を import しており、その先の repos → lib/db が
// 実 DB 接続を試みるためモックで遮断する (stores-table-empty-state.test.tsx と同規約)。
vi.mock("@/lib/actions/store-actions", () => ({
  bulkDeleteStoresAction: vi.fn(),
  deleteStoreAction: vi.fn(),
  getStoreDeleteImpactAction: vi.fn(),
}));

const { buildColumns } = await import("../stores-table-view");

/**
 * 列単体の予算 (px)。セル左右の padding 32px を含む実効幅。
 *
 * cap (`maxWidth`) を持つ列は **cap がそのまま予算**になる。cap は「ここまで伸びうる」
 * という宣言なので、いま入っているデータでの実測がそれを下回っても予算は縮まらない。
 * cap を持たない列は本番と同じフォント (Inter / Noto Sans JP) を読み込んだブラウザでの
 * 実測値で、**アイコンを持つバッジはアイコンと字間を含めて**、enum は全値のうち最長を測る。
 *
 * #220 はこのうち 3 列を取り違えていた (営業担当 97 / チャネル 110 / 業態 101)。
 * チャネルは「DM推奨」での実測で、最長の「テレアポ推奨」は 138。営業担当と業態は
 * cap を持つのに短いデータでの min-content を採っていた。結果、閾値の直上で
 * admin に 5 帯域・member に 1 帯域の横スクロールが残っていた (#237)。
 */
const BUDGET = {
  name: 260, // cap
  // 次回アクションは内側の `max-w-[240px]` が cap。240 + セル左右 32 = 272。
  next: 272,
  // 操作は admin (削除ボタンあり) で 100、member で 92。always は広い方で積む。
  actions: 100,
  stage: 96,
  salesState: 146,
  sales: 100, // cap
  location: 200, // cap
  channel: 138, // 最長「テレアポ推奨」をアイコン込みで実測
  updated: 110, // 実測 109.5 の切り上げ
  genre: 160, // cap
} as const;

/** 常時表示する列。この 3 列だけはコンテナ幅によらず描画される。 */
const ALWAYS = ["name", "next", "actions"] as const;

/** always の上に積む順 = 優先度の高い順。`/dashboard` (#224) の落とす順と整合させている。 */
const LADDER = [
  "stage",
  "salesState",
  "sales",
  "location",
  "channel",
  "updated",
  "genre",
] as const;

/** cap を持つ列。予算は実測ではなく `maxWidth` そのもの。 */
const CAPPED = ["name", "location", "sales", "genre"] as const;

/** 決定表。`undefined` は always (常時表示)。累計は BUDGET から組み直せる (下のテスト)。 */
const EXPECTED: Record<string, ColumnMinContainerWidth | undefined> = {
  name: undefined, // 店舗名 260 ┐
  next: undefined, // 次回アクション 272 ├ always 計 632
  actions: undefined, // 操作 100 ┘
  stage: 728, // + 状態 96
  salesState: 874, // + 現在の営業状態 146
  sales: 974, // + 営業担当 100
  location: 1174, // + 最寄駅 200
  channel: 1312, // + チャネル 138
  updated: 1422, // + 最終営業日 110
  genre: 1582, // + 業態 160
};

/**
 * `/stores` のコンテナ幅の上限 (viewport 2000px 以上・サイドバー展開時の実測。PR #223)。
 * 1920px では `main` の max-width に頭打ちされてコンテナは 1486px しかないため、
 * 業態 (admin で 1582 + 48 = 1630) は 2000px 以上でのみ表示される。
 */
const WIDEST_CONTAINER = 1710;

describe("店舗一覧の列優先度", () => {
  it("列の並びと閾値が決定表と一致する", () => {
    const columns = buildColumns(false);

    expect(columns.map((c) => c.key)).toEqual([
      "name",
      "location",
      "genre",
      "salesState",
      "next",
      "stage",
      "channel",
      "sales",
      "updated",
      "actions",
    ]);

    expect(
      Object.fromEntries(columns.map((c) => [c.key, c.minContainerWidth])),
    ).toEqual(EXPECTED);
  });

  it("閾値は canDelete に依存しない (選択列ぶんの加算は DataTable 側の責務)", () => {
    const forAdmin = buildColumns(true);
    const forMember = buildColumns(false);

    expect(forAdmin.map((c) => c.minContainerWidth)).toEqual(
      forMember.map((c) => c.minContainerWidth),
    );
  });

  it("always 列はソートやフィルタの起点になる 3 列に限る", () => {
    const always = buildColumns(false)
      .filter((c) => c.minContainerWidth === undefined)
      .map((c) => c.key);

    expect(always).toEqual(["name", "next", "actions"]);
  });

  it("上限の無い列を残さない (閾値の前提が実測 min-content 幅であるため)", () => {
    // 幅が内容依存で青天井になりうるのは自由入力のテキスト列。
    // truncate + maxWidth か、閉じた enum のバッジであることを求める。
    // cap と予算の一致は共有ヘルパが見る (cap を宣言していない列が maxWidth を
    // 持っていないことも含む)。ここでは truncate との対応だけを足す。
    const columns = buildColumns(false);

    expectCapsMatchBudget({ columns, budget: BUDGET, capped: CAPPED });

    for (const key of CAPPED) {
      expect(
        columns.find((c) => c.key === key)!.truncate,
        `${key} は truncate されるべき`,
      ).toBe(true);
    }
  });

  it("always 列の min-content 合計がカード切替閾値に収まる (#234)", () => {
    // 「表ビューは always 列が確実に収まるときだけ描画される」という不変条件。
    // always 列を増やしたり cap を広げたりすると、表を出したまま横スクロールが
    // 残る帯が生まれる。そのときは切替閾値も一緒に上げること。
    //
    // 合計は写経せず #237 の BUDGET から積む。ここを直値にすると「予算を直したのに
    // この不変条件だけ古い数字のまま」が起こる。
    // 選択列ありの側 (680 <= 688) は両辺に同じ 48 を足すだけで下の式と同値になり
    // 何も増やさないため置かない。閾値どうしが 48px 差であることは
    // `data-table-responsive.test.ts` が別途固定している。
    const alwaysMinContent = ALWAYS.reduce((sum, key) => sum + BUDGET[key], 0);

    expect(buildColumns(false).filter((c) => c.minContainerWidth === undefined).map((c) => c.key))
      .toEqual(["name", "next", "actions"]);
    expect(alwaysMinContent).toBeLessThanOrEqual(CARD_VIEW_BREAKPOINT);
  });

  it("閾値は always 予算 + 優先度順の累積と厳密に一致する (#237)", () => {
    // 決定表 (EXPECTED) は閾値を写経しているだけなので、予算を直したのに閾値を
    // 直し忘れた事故は捕まえられない。BUDGET からの累積を独立に組み直す。
    // 検証ロジックは 3 ビュー共通 (Epic #225 Phase 2)。
    expectBudgetLadder({
      columns: buildColumns(false),
      budget: BUDGET,
      always: ALWAYS,
      ladder: LADDER,
      alwaysTotal: 632,
    });
  });

  it("最も広いコンテナでは全列が表示される (#237)", () => {
    // 積み直しで最終段が伸びるので、実効上限を超えて「どう広げても出ない列」を
    // 作っていないことを確かめる。admin は選択列 48px ぶん閾値が上がる。
    const last = EXPECTED.genre!;

    expect(last + SELECTION_COLUMN_WIDTH).toBeLessThanOrEqual(WIDEST_CONTAINER);
  });
});
