import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DataTable, type ColumnDef } from "../data-table";
import {
  COLUMN_HIDE_CLASSES,
  VIEW_SWITCH_CARD_CLASSES,
  VIEW_SWITCH_TABLE_CLASSES,
} from "../data-table-responsive";

/**
 * 表 ⇄ カードの切替 (#234 / PR3/3) の描画テスト。
 *
 * ここが守っているのは 2 つ。
 * 1. **cardView 未指定のテーブルに一切影響しないこと** (dashboard / handoffs)
 * 2. **どの経路でも「両方消える」が起こらないこと** (素の hidden を置かない)
 *
 * jsdom は未導入なので renderToStaticMarkup + 正規表現で HTML を数える
 * (data-table-responsive-cells.test.tsx と同規約)。
 */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/stores",
  useSearchParams: () => new URLSearchParams(),
}));

interface Row {
  id: string;
  label: string;
}

const ROWS: Row[] = [
  { id: "a", label: "あ" },
  { id: "b", label: "い" },
  { id: "c", label: "う" },
];

const COLUMNS: ColumnDef<Row>[] = [
  { key: "label", header: "ラベル", cell: (r) => r.label },
  { key: "stage", header: "状態", minContainerWidth: 728, cell: () => "—" },
];

const CARD_VIEW = {
  label: "テスト一覧 (カード表示)",
  render: (r: Row) => <div data-card>{r.label}</div>,
};

const render = (props: Partial<Parameters<typeof DataTable<Row>>[0]> = {}) =>
  renderToStaticMarkup(
    <DataTable
      columns={COLUMNS}
      rows={ROWS}
      rowKey={(r) => r.id}
      emptyState={<p>空です</p>}
      {...props}
    />,
  );

/** 開始タグを列挙する。 */
const tags = (html: string, name: string) =>
  html.match(new RegExp(`<${name}\\b[^>]*>`, "g")) ?? [];

describe("cardView 未指定 (既存テーブルへの影響)", () => {
  it("カードリストを描画しない", () => {
    const html = render();
    expect(html).not.toContain("<ul");
    expect(html).not.toContain('role="list"');
  });

  it("table に切替クラスが付かない", () => {
    const html = render();
    for (const cls of [
      ...Object.values(VIEW_SWITCH_TABLE_CLASSES),
      ...Object.values(VIEW_SWITCH_CARD_CLASSES),
    ]) {
      expect(html, `${cls} が出ている`).not.toContain(cls);
    }
  });

  it("段階表示の列クラスは従来どおり出る", () => {
    expect(render()).toContain(COLUMN_HIDE_CLASSES[728]);
  });
});

describe("cardView 指定", () => {
  it("表とカードリストの両方を DOM に出す", () => {
    // 片方だけ描画する設計 (JS 判定) を採らなかったことの担保。
    const html = render({ cardView: CARD_VIEW });
    expect(tags(html, "table")).toHaveLength(1);
    expect(html).toContain('role="list"');
    expect(html).toContain('aria-label="テスト一覧 (カード表示)"');
    expect(tags(html, "li")).toHaveLength(ROWS.length);
  });

  it("表とカードに互いに排他な切替クラスが付く", () => {
    const html = render({ cardView: CARD_VIEW });
    expect(html).toContain(VIEW_SWITCH_TABLE_CLASSES.false);
    expect(html).toContain(VIEW_SWITCH_CARD_CLASSES.false);
    // 選択列なしなので +48px 側は出ない
    expect(html).not.toContain(VIEW_SWITCH_TABLE_CLASSES.true);
    expect(html).not.toContain(VIEW_SWITCH_CARD_CLASSES.true);
  });

  it("素の hidden クラスを基底に置かない (フェイルセーフの構造)", () => {
    // CSS 生成失敗 / コンテナクラス欠落 / 非対応ブラウザのどの経路でも
    // 「両方出る」に劣化させ、「どちらも出ない」を構造的に不可能にする。
    const html = render({ cardView: CARD_VIEW });
    expect(html).not.toMatch(/class="[^"]*(?:^|\s)hidden(?:\s|")/);
  });

  it("rowSelection があると +48px 側の閾値に切り替わる", () => {
    const html = render({
      cardView: CARD_VIEW,
      rowSelection: { selectedRowKeys: [], onChange: vi.fn() },
    });
    expect(html).toContain(VIEW_SWITCH_TABLE_CLASSES.true);
    expect(html).toContain(VIEW_SWITCH_CARD_CLASSES.true);
    expect(html).not.toContain(VIEW_SWITCH_TABLE_CLASSES.false);
  });

  it("カードにも行チェックボックスと全選択を出す", () => {
    // thead のチェックボックスはカードモードで消えるため、等価物が無いと
    // admin は狭幅で一括操作へ到達できなくなる。
    const html = render({
      cardView: CARD_VIEW,
      rowSelection: { selectedRowKeys: [], onChange: vi.fn() },
    });
    // 1 (thead) + 3 (tbody) + 1 (カード全選択) + 3 (カード各行)
    expect(tags(html, "input")).toHaveLength(1 + ROWS.length + 1 + ROWS.length);
    expect(html).toContain("すべて選択");
  });

  it("rowSelection が無ければカードにチェックボックスを出さない", () => {
    const html = render({ cardView: CARD_VIEW });
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain("すべて選択");
  });

  it("0 件のときは表もカードも描画しない", () => {
    // 空状態が二重に出ないこと。
    const html = render({ cardView: CARD_VIEW, rows: [] });
    expect(html).toContain("空です");
    expect(tags(html, "table")).toHaveLength(0);
    expect(html).not.toContain('role="list"');
  });

  it("カードの中身は render で渡したものを使う", () => {
    const html = render({ cardView: CARD_VIEW });
    expect(tags(html, "div").filter((t) => t.includes("data-card"))).toHaveLength(
      ROWS.length,
    );
  });

  it("ソート可能な列があればカードモードに並び替えを出す", () => {
    const sortable: ColumnDef<Row>[] = [
      { key: "label", header: "ラベル", sortKey: "label", cell: (r) => r.label },
    ];
    const html = render({ cardView: CARD_VIEW, columns: sortable });
    expect(html).toContain('aria-label="並び替え"');
    expect(html).toContain("<select");
  });

  it("ソート可能な列が無ければ並び替えを出さない", () => {
    // COLUMNS には sortKey が無い。
    expect(render({ cardView: CARD_VIEW })).not.toContain("<select");
  });
});

describe("選択列のタッチターゲット (#234)", () => {
  it("チェックボックスを 44px の label で包む", () => {
    const html = render({
      rowSelection: { selectedRowKeys: [], onChange: vi.fn() },
    });
    // input 自体は 16px のまま。ヒット領域だけを広げる。
    expect(tags(html, "label").filter((t) => t.includes("h-11 w-11")).length)
      .toBeGreaterThanOrEqual(1 + ROWS.length);
    expect(html).toContain('class="h-4 w-4 accent-primary"');
  });

  it("セル幅は w-12 (= 4px padding + 44px) で選択列の予算を保つ", () => {
    // 48px を維持することで SELECTION_COLUMN_WIDTH と段階表示の閾値表が不変になる。
    const html = render({
      rowSelection: { selectedRowKeys: [], onChange: vi.fn() },
    });
    expect(html).toContain("px-0.5 py-0");
    expect(html).toContain("w-12");
    expect(html).not.toContain("w-10 text-center");
  });
});
