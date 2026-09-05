/**
 * 引き継ぎ一覧の列優先度 (#224 / #220 の横展開) の配分を固定するテスト。
 *
 * 閾値は列単体の実測幅を優先度順に累計して決めており、1 列でも配分を変えると
 * その列以降の予算がまとめてずれる。ここで表を固定して、変更が「意図的な差分」として
 * レビューに乗るようにする。
 *
 * 注: `stores-table-columns.test.tsx` の `vi.mock` はこの view には要らない
 * (Server Action を import していないため lib/db に到達しない)。コピペしないこと。
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
import type { Handoff } from "@/types/handoff";
import { buildColumns } from "../handoffs-table-view";

/**
 * 列単体の予算 (px)。セル左右の padding 32px を含む実効幅。
 *
 * cap (`maxWidth`) を持つ列は **cap がそのまま予算**。cap を持たない列は本番と同じ
 * フォントを読み込んだブラウザでの実測値で、閉じた enum は全値のうち最長を測る。
 *
 * `/dashboard` (#224) はチャネルをアイコン抜きで見積もって 3 段まとめて 16px 不足させ、
 * `/stores` (#237) は cap を持つ列に短いデータでの min-content を採って admin に
 * 5 帯域の横スクロールを残した。この表は下の累積テストと対で意味を持つ。
 */
const BUDGET = {
  store: 200, // cap
  status: 120, // 閉じた enum のバッジ (運用確認待ち / 完了)
  due: 108, // 固定書式の日付
  ops: 100, // cap
  fee: 189, // 金額 2 段。cap を付けられない (下記)
} as const;

/** 常時表示する列。この画面はフィルタ UI が無いので状態が唯一のトリアージ軸。 */
const ALWAYS = ["store", "status"] as const;

/** always の上に積む順 = 優先度の高い順。 */
const LADDER = ["due", "ops", "fee"] as const;

/** cap を持つ列。予算は実測ではなく `maxWidth` そのもの。 */
const CAPPED = ["store", "ops"] as const;

/**
 * 累積と閾値のズレ。**閾値は列幅の丸め和ではなくテーブルの実 min-content を採る**ため、
 * 初期・月額までの累積 320 + 108 + 100 + 189 = 717 に対し実測は 718 だった。
 * 717 にするとその帯に 1px の横スクロールが残る (#224 の掃引検証で検出済み)。
 */
const SLACK = { fee: 1 } as const;

/** 決定表。`undefined` は always (常時表示)。内訳は data-table-responsive.ts と対。 */
const EXPECTED: Record<string, ColumnMinContainerWidth | undefined> = {
  store: undefined, // 店舗 200 (cap) ┐
  status: undefined, // 状態 120      ┴ always 計 320
  due: 428, // + 期日 108
  ops: 528, // + 運用担当 100 (cap)
  fee: 718, // + 初期/月額 189 (cap なし。最下位に置いて後続を作らない)
  //          閾値は列幅の和 717 ではなくテーブルの実 min-content 718。
};

/** 状態バッジ (運用確認待ち / 完了) の実効幅。閉じた enum なので確定する。 */
const STATUS_COLUMN_BUDGET = 120;

/** コンテナ幅 `w` で表示される列 (判定ロジックは 3 ビュー共通)。 */
function visibleAt(w: number): string[] {
  return visibleColumnsAt(buildColumns(), w);
}

function handoffWith(partial: Partial<Handoff>): Handoff {
  return {
    id: "h1",
    store_name: "",
    ops_assignee: "",
    due_date: "2026-12-31",
    initial_fee: 0,
    monthly_fee: 0,
    status: "完了",
    ...partial,
  } as Handoff;
}

describe("引き継ぎ一覧の列優先度", () => {
  it("列の並びと閾値が決定表と一致する", () => {
    const columns = buildColumns();

    // DOM 上の並び順は #224 で変えていない。
    expect(columns.map((c) => c.key)).toEqual([
      "store",
      "fee",
      "ops",
      "due",
      "status",
    ]);

    expect(
      Object.fromEntries(columns.map((c) => [c.key, c.minContainerWidth])),
    ).toEqual(EXPECTED);
  });

  it("閾値は always 予算 + 優先度順の累積と厳密に一致する (Epic #225 Phase 2)", () => {
    // 決定表 (EXPECTED) は閾値を写経しているだけなので、cap や実測値を直したのに
    // 閾値を直し忘れた事故は捕まえられない。予算からの累積を独立に組み直す。
    // `/stores` (#237) と `/dashboard` (#224) には既にあり、ここだけ無かった。
    expectBudgetLadder({
      columns: buildColumns(),
      budget: BUDGET,
      always: ALWAYS,
      ladder: LADDER,
      alwaysTotal: 320,
      slack: SLACK,
    });
  });

  it("cap を持つ列は maxWidth と予算が一致する (Epic #225 Phase 2)", () => {
    // cap 列の予算は実測ではなく maxWidth そのもの。片方だけ動かすと上の累積が嘘になる。
    expectCapsMatchBudget({ columns: buildColumns(), budget: BUDGET, capped: CAPPED });
  });

  it("always 列は店舗と状態の 2 列で、375px のコンテナに収まる", () => {
    const columns = buildColumns();
    const always = columns
      .filter((c) => c.minContainerWidth === undefined)
      .map((c) => c.key);

    // この画面にはフィルタ UI が無いので、状態が目視スキャンの唯一のトリアージ軸。
    expect(always).toEqual(["store", "status"]);

    const storeCap = Number.parseInt(
      columns.find((c) => c.key === "store")!.maxWidth!,
      10,
    );
    expect(storeCap + STATUS_COLUMN_BUDGET).toBeLessThanOrEqual(NARROWEST_CONTAINER);
  });

  it("上限の無い列は fee だけで、かつ最後に現れる列である", () => {
    // 金額を ellipsis で切ると「¥1,234,567 / ¥1,2…」となり桁を誤読させる
    // (align:"right" でも ellipsis は行末側に出るので回避できない)。
    // 上限の無い列が危険なのは「その列以降の閾値がまとめてずれる」からなので、
    // 最大の閾値を持たせて後続を作らないことで無害化している。
    const columns = buildColumns();
    const fee = columns.find((c) => c.key === "fee")!;

    expect(fee.truncate).toBeUndefined();
    expect(fee.maxWidth).toBeUndefined();
    expect(fee.minContainerWidth).toBe(
      Math.max(...columns.map((c) => c.minContainerWidth ?? 0)),
    );

    // 金額は右寄せ。DataTable が align:"right" に tabular-nums を付ける。
    expect(fee.align).toBe("right");
  });

  it("自由入力の列に上限が付いている", () => {
    const columns = buildColumns();
    const column = (key: string) => columns.find((c) => c.key === key)!;

    // cap の値そのものは上の `cap を持つ列は maxWidth と予算が一致する` が
    // BUDGET と突き合わせる。ここでは truncate との対応だけを見る。
    for (const key of CAPPED) {
      expect(column(key).truncate, `${key} は truncate されるべき`).toBe(true);
    }

    // 期日は固定書式、状態は閉じた enum のバッジなので cap 不要。
    for (const key of ["due", "status"]) {
      expect(column(key).maxWidth, `${key} は cap 不要`).toBeUndefined();
      expect(column(key).truncate, `${key} は truncate 不要`).toBeUndefined();
    }
  });

  it("ソート可能な列を持たない", () => {
    // sortKey を付けると「ソート中の列は隠さない」が働き、閾値の意味が
    // 「常に成り立つ予算」から「ソート状態次第の予算」へ変わる。
    expect(buildColumns().every((c) => c.sortKey === undefined)).toBe(true);
  });
});

describe("コンテナ幅ごとの表示列", () => {
  // この画面は grid を通らないのでコンテナ幅は /stores と同一。
  it.each([
    [341, 2, "375px サイドバー非表示"],
    [478, 3, "768px サイドバー展開"],
    [654, 4, "768px サイドバー折畳"],
    [733, 5, "1023px サイドバー展開 (全列)"],
    [734, 5, "1024px サイドバー展開 (全列)"],
    [910, 5, "1024px サイドバー折畳"],
    [1150, 5, "1440px サイドバー展開"],
    [1486, 5, "1920px"],
  ])("コンテナ %ipx で %i 列 (%s)", (width, count) => {
    expect(visibleAt(width)).toHaveLength(count);
  });

  it("1024px サイドバー展開で横スクロールが消える (全 5 列)", () => {
    expect(visibleAt(734)).toEqual(["store", "fee", "ops", "due", "status"]);
  });

  it("md 境界で列が減る区間があるのは意図どおり", () => {
    // 767px ではサイドバーが無く padding も 32 なのでコンテナは 733px。
    // 768px でサイドバー 240px が出現し padding も 48 になり 478px へ落ちる。
    // dashboard の lg 境界と同型の崖で、コンテナクエリはこれに正しく追従する。
    expect(visibleAt(478).length).toBeLessThan(visibleAt(733).length);
    expect(visibleAt(733)).toEqual(expect.arrayContaining(visibleAt(478)));
  });
});

describe("title (省略時の全文ツールチップ)", () => {
  const column = (key: string) => buildColumns().find((c) => c.key === key)!;

  it("店舗名と運用担当は全文を title に載せる", () => {
    const row = handoffWith({
      store_name: "炭火焼鳥と自然派ワイン とりとワイン 渋谷道玄坂店",
      ops_assignee: "佐々木健太郎",
    });

    expect(column("store").title?.(row)).toBe(
      "炭火焼鳥と自然派ワイン とりとワイン 渋谷道玄坂店",
    );
    expect(column("ops").title?.(row)).toBe("佐々木健太郎");
  });

  it.each([
    ["店舗", "store" as const, { store_name: "" }],
    ["運用担当", "ops" as const, { ops_assignee: "" }],
  ])("%s が空なら title を付けない", (_label, key, partial) => {
    // 「—」をツールチップに出さない。
    expect(column(key).title?.(handoffWith(partial))).toBeUndefined();
  });

  it("運用担当が空ならダッシュ表示になる", () => {
    expect(
      renderToStaticMarkup(
        <>{column("ops").cell(handoffWith({ ops_assignee: "" }))}</>,
      ),
    ).toContain("—");
  });

  it("金額は途中で切らずに全桁を描画する", () => {
    const html = renderToStaticMarkup(
      <>{column("fee").cell(handoffWith({ initial_fee: 9999999, monthly_fee: 999999 }))}</>,
    );

    expect(html).toContain("¥9,999,999");
    expect(html).toContain("¥999,999");
  });
});
