import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DataTable, type ColumnDef } from "../data-table";
import {
  COLUMN_HIDE_CLASSES,
  COLUMN_HIDE_CLASSES_WITH_SELECTION,
  DATA_TABLE_CONTAINER_CLASS,
} from "../data-table-responsive";

/**
 * 列の段階表示クラスが `<th>` と `<td>` の**双方**へ付くことの回帰テスト (#220)。
 *
 * これは issue が名指しで警告している事故 (「片方だけ直る」= ヘッダと本文で列がずれる)
 * を潰すためのもの。jsdom / testing-library は未導入なので `renderToStaticMarkup` で
 * 実際の HTML を作り、クラス名の出現位置と回数を数える。
 *
 * `next/navigation` だけモックすれば `DataTableRow` (useRouter/useTransition) と
 * `SortableHeader` (useSearchParams/usePathname) の双方が動く。
 */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/stores",
  useSearchParams: () => new URLSearchParams(),
}));

interface Row {
  id: string;
  label: string;
}

const ROWS: Row[] = [{ id: "1", label: "alpha" }];

/** 最終営業日と同じく `key` と `sortKey` が食い違う列を含める。 */
function columns(): ColumnDef<Row>[] {
  return [
    { key: "always", header: "常時", cell: (r) => r.label },
    { key: "gated", header: "段階", minContainerWidth: 728, cell: () => "g" },
    {
      key: "updated",
      header: "最終営業日",
      sortKey: "meeting",
      minContainerWidth: 1391,
      cell: () => "u",
    },
  ];
}

function render(props: Partial<Parameters<typeof DataTable<Row>>[0]> = {}) {
  return renderToStaticMarkup(
    <DataTable
      columns={columns()}
      rows={ROWS}
      rowKey={(r) => r.id}
      {...props}
    />,
  );
}

/** 開始タグを種類ごとに抜き出す (属性まで含む)。 */
function tags(html: string, name: "th" | "td"): string[] {
  return html.match(new RegExp(`<${name}\\b[^>]*>`, "g")) ?? [];
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("DataTable の列段階表示", () => {
  it("スクロールラッパに名前付きコンテナが付く", () => {
    expect(render()).toContain(DATA_TABLE_CONTAINER_CLASS);
  });

  it("閾値クラスが th と td の双方に付く", () => {
    const html = render();
    const token = COLUMN_HIDE_CLASSES[728];

    expect(tags(html, "th").filter((t) => t.includes(token))).toHaveLength(1);
    expect(tags(html, "td").filter((t) => t.includes(token))).toHaveLength(ROWS.length);
    // th 1 + td (行数) 以外に出現しないこと = 片方だけ付いた/余計に付いた事故の検出
    expect(countOccurrences(html, token)).toBe(1 + ROWS.length);
  });

  it("minContainerWidth を持たない列にはどの閾値クラスも付かない", () => {
    const html = render();

    // 段階表示クラスを持たない th/td は「常時」列の分だけ (th 1 + td 行数)。
    const bare = [...tags(html, "th"), ...tags(html, "td")].filter(
      (t) => !t.includes("@max-"),
    );
    expect(bare).toHaveLength(1 + ROWS.length);

    // 使っていない閾値のクラスが紛れ込んでいないこと。
    const used = new Set([COLUMN_HIDE_CLASSES[728], COLUMN_HIDE_CLASSES[1391]]);
    for (const token of Object.values(COLUMN_HIDE_CLASSES)) {
      if (used.has(token)) continue;
      expect(html).not.toContain(token);
    }
  });

  it("選択列があると +48px 側の閾値へ切り替わる", () => {
    const html = render({
      rowSelection: {
        selectedRowKeys: [],
        onChange: vi.fn(),
      },
    });
    expect(html).toContain(COLUMN_HIDE_CLASSES_WITH_SELECTION[728]);
    expect(html).not.toContain(COLUMN_HIDE_CLASSES[728]);
  });

  it("ソート中の列は th/td ともに閾値クラスを持たない (要件5)", () => {
    const html = render({ activeSortKey: "meeting" });
    expect(html).not.toContain(COLUMN_HIDE_CLASSES[1391]);
    // 他の列は影響を受けない
    expect(html).toContain(COLUMN_HIDE_CLASSES[728]);
  });

  it("強制表示の判定は key ではなく sortKey を見る", () => {
    // key:"updated" を activeSortKey に渡しても、sortKey は "meeting" なので隠れたまま。
    const html = render({ activeSortKey: "updated" });
    expect(html).toContain(COLUMN_HIDE_CLASSES[1391]);
  });
});
