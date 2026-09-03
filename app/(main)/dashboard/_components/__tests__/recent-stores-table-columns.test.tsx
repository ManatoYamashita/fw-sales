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
import type { Store } from "@/types/store";
import { buildColumns } from "../recent-stores-table-view";

/** 決定表。`undefined` は always (常時表示)。内訳は data-table-responsive.ts と対。 */
const EXPECTED: Record<string, ColumnMinContainerWidth | undefined> = {
  name: undefined, // 店舗名 200 (cap) ┐
  stage: undefined, // 状態 96         ┴ always 計 296
  location: 456, // + エリア 160 (cap)
  channel: 578, // + チャネル 122
  updated: 673, // + 更新 95
  genre: 813, // + 業態 140 (cap)
};

/**
 * このカードのコンテナ幅の下端。viewport 375px・サイドバー非表示のとき
 * `375 − padding 32 − Card border 2 = 341`。Epic #225 の下限幅がここ。
 */
const NARROWEST_CONTAINER = 341;

/** 状態バッジ (未調査 / 調査済み / 架電済み) の実効幅。閉じた enum なので確定する。 */
const STAGE_COLUMN_BUDGET = 96;

/**
 * コンテナ幅 `w` で表示される列。
 * CSS 側は `@container (width < N)` で隠すので、表示条件は `w >= N`。
 */
function visibleAt(w: number): string[] {
  return buildColumns()
    .filter((c) => c.minContainerWidth === undefined || w >= c.minContainerWidth)
    .map((c) => c.key);
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

  it("always 列は店舗名と状態の 2 列で、375px のコンテナに収まる", () => {
    const columns = buildColumns();
    const always = columns
      .filter((c) => c.minContainerWidth === undefined)
      .map((c) => c.key);

    expect(always).toEqual(["name", "stage"]);

    // 店舗名の cap を `/stores` と同じ 260px へ戻すと 260 + 96 = 356 > 341 となり、
    // 375px で横スクロールが復活する。cap と always 集合はこの不等式で結ばれている。
    const nameCap = Number.parseInt(
      columns.find((c) => c.key === "name")!.maxWidth!,
      10,
    );
    expect(nameCap + STAGE_COLUMN_BUDGET).toBeLessThanOrEqual(NARROWEST_CONTAINER);
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

    const caps: Record<string, string> = {
      name: "200px",
      location: "160px",
      genre: "140px",
    };
    for (const [key, maxWidth] of Object.entries(caps)) {
      expect(column(key).maxWidth, `${key} の上限`).toBe(maxWidth);
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
