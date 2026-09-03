/**
 * ダッシュボード「最近登録した店舗」の列優先度 (#224) を固定するテスト。
 *
 * このテーブルは `dashboard/page.tsx` の `lg:grid-cols-3` の `col-span-2` に置かれ、
 * コンテナ幅が 1920px viewport でも約 985px にしかならない。/stores の閾値
 * (728〜1492) では段階表示が成立しないため専用の帯を新設しており、その配分が
 * 崩れていないことをここで担保する。
 *
 * /dashboard は現在 proxy で無効化 (`lib/domain/nav-routes.ts`) されておりブラウザ
 * 実測にゲート解除が要るため、**数値はソースから導出できる形に落として**ある
 * (自由入力列は maxWidth = 予算、それ以外は #220 の実測値を流用)。
 *
 * 対象モジュールは Link / ui / feature badge / date utils しか import しておらず
 * repos や Server Action へ到達しないため、/stores 側と違い `vi.mock` による
 * DB 遮断は不要。
 */

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ColumnMinContainerWidth } from "@/components/ui/data-table-responsive";
import {
  COLUMN_HIDE_CLASSES_WITH_SELECTION,
  DATA_TABLE_CONTAINER_CLASS,
} from "@/components/ui/data-table-responsive";
import type { Store } from "@/types/store";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(),
}));

const { RECENT_STORES_COLUMNS, RecentStoresTableView } = await import(
  "../recent-stores-table-view"
);

/**
 * 列ごとの予算 (px)。td 左右 padding 32px (density=normal の `px-4`) を含む。
 *
 * - 自由入力列 (name / location / genre) は `maxWidth` がそのまま予算になる
 *   (cap が無いと min-content が青天井になり、下の累積計算が成立しない)
 * - stage / channel は #220 の実測値。同一の Badge コンポーネント・同一の見出し
 * - updated は #220「最終営業日」の実測 110 を流用。見出しが 5 文字 → 2 文字と
 *   短いぶん実値は 110 以下に収まる (多め = 安全side。列が少し遅く出るだけ)
 */
const BUDGET = {
  name: 200,
  stage: 96,
  channel: 110,
  updated: 110,
  location: 136,
  genre: 140,
} as const;

const ALWAYS = ["name", "stage"] as const;
/** always の上に積む順 = 優先度の高い順。 */
const LADDER = ["channel", "updated", "location", "genre"] as const;

/** 決定表。`undefined` は always (常時表示)。 */
const EXPECTED: Record<string, ColumnMinContainerWidth | undefined> = {
  name: undefined, // 店舗名 200 ┐ always 計 296
  stage: undefined, // 状態 96   ┘
  channel: 406, // + チャネル 110
  updated: 516, // + 更新 110
  location: 652, // + エリア 136 (654px の平地に載せるための意図的な cap)
  genre: 792, // + 業態 140
};

const column = (key: string) => {
  const c = RECENT_STORES_COLUMNS.find((x) => x.key === key);
  expect(c, `列 ${key} が存在しない`).toBeDefined();
  return c!;
};

/** そのコンテナ幅で表示される列数。 */
const visibleAt = (w: number) =>
  RECENT_STORES_COLUMNS.filter(
    (c) => c.minContainerWidth === undefined || c.minContainerWidth <= w,
  ).length;

const SAMPLE = {
  id: "s1",
  name: "さくら屋 渋谷店",
  prefecture: "東京都",
  city: "渋谷区",
  genre: "居酒屋",
  stage: "not_started",
  channel: "未判定",
  updated_at: "2026-09-01T00:00:00.000Z",
} as unknown as Store;

describe("最近登録した店舗の列優先度", () => {
  it("列の並びと閾値が決定表と一致する", () => {
    expect(RECENT_STORES_COLUMNS.map((c) => c.key)).toEqual([
      "name",
      "location",
      "genre",
      "stage",
      "channel",
      "updated",
    ]);
    expect(
      Object.fromEntries(
        RECENT_STORES_COLUMNS.map((c) => [c.key, c.minContainerWidth]),
      ),
    ).toEqual(EXPECTED);
  });

  it("always 列は店舗名と状態の 2 つに限る", () => {
    // 3 列目 (110px) まで always にすると 406px となり、375px viewport の
    // コンテナ (341px) で横スクロールが復活する。
    expect(
      RECENT_STORES_COLUMNS.filter((c) => c.minContainerWidth === undefined).map(
        (c) => c.key,
      ),
    ).toEqual([...ALWAYS]);
  });

  it("閾値は always 予算 + 優先度順の累積と厳密に一致する", () => {
    // ここが本テストの要。列の cap や優先度を変えたら、この累積も一緒に動く。
    let acc = ALWAYS.reduce((sum, k) => sum + BUDGET[k], 0);
    expect(acc, "always 合計").toBe(296);
    for (const key of LADDER) {
      acc += BUDGET[key];
      expect(column(key).minContainerWidth, `${key} の閾値`).toBe(acc);
    }
  });

  it("自由入力列は maxWidth で上限が閉じており、予算と一致する", () => {
    // cap が無いと min-content が青天井になり、上の累積計算の前提が崩れる。
    // cap だけ変えて閾値を直し忘れる事故もここで捕まる。
    for (const [key, px] of [
      ["name", 200],
      ["location", 136],
      ["genre", 140],
    ] as const) {
      const c = column(key);
      expect(c.maxWidth, `${key} の maxWidth`).toBe(`${px}px`);
      expect(c.truncate, `${key} の truncate`).toBe(true);
      expect(c.title?.(SAMPLE), `${key} の title`).toBeTruthy();
      expect(BUDGET[key], `${key} の BUDGET と maxWidth の不一致`).toBe(px);
    }
  });

  it("title は値が空のとき undefined を返す (「—」表示に tooltip を出さない)", () => {
    const empty = { ...SAMPLE, prefecture: "", city: "", genre: "" } as Store;
    expect(column("location").title?.(empty)).toBeUndefined();
    expect(column("genre").title?.(empty)).toBeUndefined();
  });

  it("閾値は選択列の有無に依存しない", () => {
    // +48px は DataTable 側 (resolveColumnHideClass) の責務。列定義は素の値を持つ。
    for (const c of RECENT_STORES_COLUMNS) {
      if (c.minContainerWidth === undefined) continue;
      expect(Object.keys(EXPECTED)).toContain(c.key);
      expect(c.minContainerWidth).toBe(EXPECTED[c.key]);
    }
  });

  it("ソート可能な列を持たない", () => {
    // activeSortKey による強制表示が無関係である前提を固定する。
    // ソートを足すなら閾値の見積もりを取り直すこと (強制表示は予算を超えうる)。
    expect(RECENT_STORES_COLUMNS.filter((c) => c.sortKey)).toEqual([]);
  });
});

describe("コンテナ平地ごとの表示列数", () => {
  /**
   * コンテナ幅 = main 内側幅から grid の取り分を計算した値。
   * main は `px-4 md:px-6` + `max-w-screen-2xl`、サイドバーは 240px ⇔ 64px。
   */
  const PLATEAUS = [
    { w: 341, where: "375px / サイドバー非表示", n: 2 },
    { w: 478, where: "768px / 展開", n: 3 },
    { w: 483, where: "1024px / 展開 (lg 直後)", n: 3 },
    { w: 601, where: "1024px / 折畳", n: 4 },
    { w: 654, where: "768px 折畳 / 1280px 展開", n: 5 },
    { w: 733, where: "1023px / 展開 (lg 直前)", n: 5 },
    { w: 761, where: "1440px / 展開", n: 5 },
    { w: 825, where: "1536px / 展開", n: 6 },
    { w: 985, where: "1920px", n: 6 },
  ];

  it.each(PLATEAUS)("$where (コンテナ $w px) で $n 列", ({ w, n }) => {
    expect(visibleAt(w)).toBe(n);
  });

  it("lg 境界ではコンテナが狭くなるぶん列が減る (viewport に対して単調ではない)", () => {
    // grid-cols-1 → lg:grid-cols-3 の切替で viewport を 1px 広げるとコンテナは
    // 733 → 483px と 250px 狭くなる。これは仕様であって不具合ではない。
    // 「良かれと思って直す」事故と、将来 grid を変えたときの気づかない挙動変化の
    // 両方をここで捕まえる。
    expect(visibleAt(483)).toBeLessThan(visibleAt(733));
  });

  it("375px のコンテナでも always の 2 列は必ず出る", () => {
    expect(visibleAt(341)).toBe(ALWAYS.length);
  });
});

describe("描画", () => {
  const html = () =>
    renderToStaticMarkup(<RecentStoresTableView rows={[SAMPLE]} />);

  it("名前付きコンテナを張る", () => {
    expect(html()).toContain(DATA_TABLE_CONTAINER_CLASS);
  });

  it("選択列ありのラダーを使わない", () => {
    // このテーブルは rowSelection を渡していないので、+48px 側のクラスは
    // 1 つも出てはいけない。渡し忘れではなく「使わない」ことの明示。
    const out = html();
    for (const cls of Object.values(COLUMN_HIDE_CLASSES_WITH_SELECTION)) {
      expect(out, `${cls} が出ている`).not.toContain(cls);
    }
    expect(out).not.toContain('type="checkbox"');
  });
});
