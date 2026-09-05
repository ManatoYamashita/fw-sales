/**
 * dashboard「最近登録した店舗」の列優先度 (#224 / #220 の横展開) の配分を固定するテスト。
 *
 * 閾値は列単体の実測幅を優先度順に累計して決めており、1 列でも配分を変えると
 * その列以降の予算がまとめてずれる。ここで表を固定して、変更が「意図的な差分」として
 * レビューに乗るようにする。
 *
 * 注: `stores-table-columns.test.tsx` は対象モジュールが Server Action を import して
 * いるため `vi.mock` で lib/db への到達を遮断しているが、**この view は Server Action を
 * import していない**ので同じモックは要らない。コピペしないこと。
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ColumnMinContainerWidth } from "@/components/ui/data-table-responsive";
import {
  NARROWEST_CONTAINER,
  expectBudgetLadder,
  expectCapsMatchBudget,
  visibleAt as visibleColumnsAt,
} from "@/components/ui/__tests__/support/column-budget";
import type { Store } from "@/types/store";
import { buildColumns } from "../recent-stores-table-view";

/**
 * 列単体の予算 (px)。セル左右の padding 32px を含む実効幅。
 *
 * cap を持つ列は `maxWidth` がそのまま予算になる。それ以外は本番と同じフォント
 * (Inter / Noto Sans JP) を読み込んだブラウザでの実測値。アイコンを持つバッジは
 * アイコンと字間を含めて測ること (チャネルの 138 はこれを外して 122 と見積もり、
 * この列以降 3 段が 16px 不足していた)。
 */
const BUDGET = {
  name: 200,
  stage: 96,
  location: 160,
  channel: 138,
  updated: 101,
  genre: 140,
} as const;

/** 常時表示する列。コンテナ幅によらず描画される。 */
const ALWAYS = ["name", "stage"] as const;

/** always の上に積む順 = 優先度の高い順。`/stores` (#220) の落とす順と整合させている。 */
const LADDER = ["location", "channel", "updated", "genre"] as const;

/** cap を持つ列。予算は実測ではなく `maxWidth` そのもの。 */
const CAPPED = ["name", "location", "genre"] as const;

/** 決定表。`undefined` は always (常時表示)。内訳は data-table-responsive.ts と対。 */
const EXPECTED: Record<string, ColumnMinContainerWidth | undefined> = {
  name: undefined, // 店舗名 200 (cap) ┐
  stage: undefined, // 状態 96         ┴ always 計 296
  location: 456, // + エリア 160 (cap)
  channel: 594, // + チャネル 138
  updated: 695, // + 更新 101
  genre: 835, // + 業態 140 (cap)
};

/** コンテナ幅 `w` で表示される列 (判定ロジックは 3 ビュー共通)。 */
function visibleAt(w: number): string[] {
  return visibleColumnsAt(buildColumns(), w);
}

function storeWith(partial: Partial<Store>): Store {
  return { id: "s1", name: "", prefecture: "", city: "", genre: "", ...partial } as Store;
}

describe("最近登録した店舗の列優先度", () => {
  it("列の並びと閾値が決定表と一致する", () => {
    const columns = buildColumns();

    // DOM 上の並び順は #224 で変えていない (minContainerWidth は優先度であって
    // 表示順とは独立。見た目を変えないことでレビュー負荷を下げる)。
    expect(columns.map((c) => c.key)).toEqual([
      "name",
      "location",
      "genre",
      "stage",
      "channel",
      "updated",
    ]);

    expect(
      Object.fromEntries(columns.map((c) => [c.key, c.minContainerWidth])),
    ).toEqual(EXPECTED);
  });

  it("閾値は always 予算 + 優先度順の累積と厳密に一致する", () => {
    // 決定表 (EXPECTED) は閾値を写経しているだけなので、cap や実測値を直したのに
    // 閾値を直し忘れた事故は捕まえられない。予算からの累積を独立に組み直す。
    // 実測値そのものの誤りは検出できない (それはブラウザ計測の仕事) が、
    // 「予算を直したのに閾値が動いていない」は必ずここで落ちる。
    expectBudgetLadder({
      columns: buildColumns(),
      budget: BUDGET,
      always: ALWAYS,
      ladder: LADDER,
      alwaysTotal: 296,
    });
  });

  it("cap を持つ列は maxWidth と予算が一致する", () => {
    // cap 列の予算は実測ではなく maxWidth そのもの。片方だけ動かすと上の累積が嘘になる。
    expectCapsMatchBudget({ columns: buildColumns(), budget: BUDGET, capped: CAPPED });
  });

  it("always 列は店舗名と状態の 2 列で、375px のコンテナに収まる", () => {
    const columns = buildColumns();
    const always = columns
      .filter((c) => c.minContainerWidth === undefined)
      .map((c) => c.key);

    expect(always).toEqual(["name", "stage"]);

    // 店舗名の cap を `/stores` と同じ 260px へ戻すと 260 + 96 = 356 > 341 となり、
    // 375px で横スクロールが復活する。cap と always 集合はこの不等式で結ばれている。
    // 状態の実効幅は写経せず BUDGET から採る。ここを直値にすると「予算を直したのに
    // この不変条件だけ古い数字のまま」が起こり、341px の破れを検出できなくなる。
    const nameCap = Number.parseInt(
      columns.find((c) => c.key === "name")!.maxWidth!,
      10,
    );
    expect(nameCap + BUDGET.stage).toBeLessThanOrEqual(NARROWEST_CONTAINER);
  });

  it("上限の無い列を残さない (閾値の前提が実測幅であるため)", () => {
    // 幅が内容依存で青天井になりうるのは自由入力のテキスト列。DB 側は全列 text で
    // 長さ制約が無く、アプリ層の文字数バリデーションも無いので、UI の maxWidth が
    // 唯一の予算制御になる。
    const columns = buildColumns();
    const column = (key: string) => {
      const found = columns.find((c) => c.key === key);
      expect(found, `列 ${key} が見つからない`).toBeDefined();
      return found!;
    };

    // cap の値そのものは上の `cap を持つ列は maxWidth と予算が一致する` が
    // BUDGET と突き合わせる。ここでは truncate との対応だけを見る。
    for (const key of CAPPED) {
      expect(column(key).truncate, `${key} は truncate されるべき`).toBe(true);
    }

    // 残る 3 列は閉じた enum のバッジ (stage / channel) か固定書式 (updated) で、
    // 内容によらず幅が確定するため cap を持たない。
    for (const key of ["stage", "channel", "updated"]) {
      expect(column(key).maxWidth, `${key} は cap 不要`).toBeUndefined();
      expect(column(key).truncate, `${key} は truncate 不要`).toBeUndefined();
    }
  });

  it("ソート可能な列を持たない", () => {
    // sortKey を付けると「ソート中の列は隠さない」(resolveColumnHideClass) が働き、
    // 閾値の意味が「常に成り立つ予算」から「ソート状態次第の予算」へ変わる。
    // 導入するときは配分ごと見直す必要があるので、ここで釘を刺しておく。
    expect(buildColumns().every((c) => c.sortKey === undefined)).toBe(true);
  });
});

describe("コンテナ幅ごとの表示列", () => {
  // 幅は `min(viewport − sidebar, cap) − padding×2 − Card border 2` を
  // lg 以上で grid (lg:col-span-2 / lg:grid-cols-3) に通した値。
  it.each([
    [341, 2, "375px サイドバー非表示"],
    [478, 3, "768px サイドバー展開"],
    [483, 3, "1024px サイドバー展開 (issue #224 の主要ゴール)"],
    [601, 4, "1024px サイドバー折畳"],
    [654, 4, "768px サイドバー折畳"],
    [733, 5, "1023px サイドバー展開"],
    [761, 5, "1440px サイドバー展開"],
    [878, 6, "1440px サイドバー折畳"],
    [985, 6, "1920px"],
    [1134, 6, "2000px 以上サイドバー展開"],
  ])("コンテナ %ipx で %i 列 (%s)", (width, count) => {
    expect(visibleAt(width)).toHaveLength(count);
  });

  it("viewport を広げると列が減る区間があるのは意図どおり", () => {
    // このカードは lg:grid-cols-3 の lg:col-span-2 にあるため、viewport が
    // 1023 → 1024px と 1px 広がるとコンテナは 733 → 483px と 250px 狭くなる。
    // 767 → 768px でもサイドバー出現 + padding 32→48 で 733 → 478px の崖がある。
    // コンテナクエリはこれに正しく追従する (viewport 方式では表現すらできない)。
    // 受け入れ条件は必ずコンテナ幅で書くこと。
    expect(visibleAt(483).length).toBeLessThan(visibleAt(733).length);
    expect(visibleAt(478).length).toBeLessThan(visibleAt(733).length);
    expect(visibleAt(733)).toEqual(expect.arrayContaining(visibleAt(483)));
  });
});

describe("title (省略時の全文ツールチップ)", () => {
  const column = (key: string) => buildColumns().find((c) => c.key === key)!;

  it("エリアは都道府県と市区町村を結合して返す", () => {
    const row = storeWith({ prefecture: "神奈川県", city: "横浜市青葉区あざみ野南" });

    expect(column("location").title?.(row)).toBe("神奈川県 / 横浜市青葉区あざみ野南");
    expect(renderToStaticMarkup(<>{column("location").cell(row)}</>)).toContain(
      "神奈川県 / 横浜市青葉区あざみ野南",
    );
  });

  it.each([
    ["両方空", { prefecture: "", city: "" }],
    ["片方だけ", { prefecture: "東京都", city: "" }],
  ])("エリアが %s のとき title は全文か undefined", (_label, partial) => {
    const row = storeWith(partial);
    const title = column("location").title?.(row);

    // 「—」をツールチップに出さない (空なら undefined)。
    expect(title === undefined || title === "東京都").toBe(true);
  });

  it.each([
    ["店舗名", "name" as const, { name: "" }],
    ["業態", "genre" as const, { genre: "" }],
  ])("%s が空なら title を付けない", (_label, key, partial) => {
    expect(column(key).title?.(storeWith(partial))).toBeUndefined();
  });

  it("業態は空のときダッシュ表示になる", () => {
    expect(
      renderToStaticMarkup(<>{column("genre").cell(storeWith({ genre: "" }))}</>),
    ).toContain("—");
  });
});
