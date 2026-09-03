/**
 * 店舗一覧の a11y / 権限 UI に関する実装ガード。
 *
 * いずれも「壊れても型エラーにならず、画面を開くまで気づけない」種類の回帰なので、
 * `stores-page-suspense.test.ts` と同じくソースレベルで機械的に固定する
 * (React component テスト環境がリポジトリに未導入で、新規依存の追加も避けるため)。
 *
 * A. 行クリック (`rowHref`) はマウス専用の便宜であり、`<tr>` は tabIndex を持たない。
 *    店舗名に実 `<a>` が無いと、キーボード / Cmd・Ctrl+click / middle click /
 *    新規タブのいずれからも店舗詳細へ到達できなくなる。
 * B. 破壊的操作 UI (チェックボックス列 / 削除ボタン) の判定は **server props**。
 *    client hook (`useIsAdmin().loaded`) 方式に戻すと、初期描画後にチェックボックス列が
 *    出入りしてテーブルが横にずれる。
 * C. `sales=me` の解決失敗時に `"none"` (未担当) へフォールバックしてはいけない。
 */

import { beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

const read = (rel: string) =>
  readFile(path.join(process.cwd(), rel), "utf8");

/** ブロックコメント / 行コメントを取り除く (説明文への誤ヒットを避ける)。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

let viewCode: string;
let rowCode: string;
let tableCode: string;
let actionsCode: string;
let dataTableCode: string;

beforeAll(async () => {
  viewCode = stripComments(
    await read("app/(main)/stores/_components/stores-table-view.tsx"),
  );
  rowCode = stripComments(await read("components/ui/data-table-row.tsx"));
  tableCode = stripComments(
    await read("app/(main)/stores/_components/stores-table.tsx"),
  );
  actionsCode = stripComments(
    await read("app/(main)/stores/_components/store-row-actions.tsx"),
  );
  dataTableCode = stripComments(await read("components/ui/data-table.tsx"));
});

describe("A: 店舗名は正式なリンクである", () => {
  it("店舗名セルが next/link の <Link> を描画する", () => {
    expect(viewCode).toContain('import Link from "next/link"');
    expect(viewCode).toMatch(/<Link\s+href=\{storeDetailHref\(r\)\}/);
  });

  it("行クリックと店舗名リンクが同じ遷移先関数を共有する", () => {
    // 別々に組み立てると「行のどこを押したかで飛び先が変わる」regression が起きる。
    expect(viewCode).toMatch(
      /const storeDetailHref = \(row: SalesProgressRow\) =>\s*`\/stores\/\$\{row\.store\.id\}\?tab=progress`/,
    );
    expect(viewCode).toContain("rowHref={storeDetailHref}");
  });

  it("行ナビゲーションは入れ子の interactive 要素を無視する (二重発火の防止)", () => {
    // 店舗名 <a> のクリックで <tr> 側の router.push が同時に走らないための前提。
    expect(rowCode).toContain("shouldSkipNavigation");
    expect(rowCode).toMatch(
      /target\.closest\("a, button, input, select, textarea, \[role='button'\]"\)/,
    );
    // onClick / onKeyDown の両方が同じガードを通ること
    const guarded = rowCode.match(/shouldSkipNavigation\(e\.target\)/g) ?? [];
    expect(guarded.length).toBeGreaterThanOrEqual(2);
  });
});

describe("B: 破壊的操作 UI はサーバ判定の props で出し分ける", () => {
  it("一覧ビューは client の useIsAdmin に依存しない", () => {
    expect(viewCode).not.toContain("useIsAdmin");
  });

  it("チェックボックス列は canDelete のときだけ DataTable へ渡す", () => {
    expect(viewCode).toMatch(/rowSelection=\{\s*canDelete\s*\?/);
    expect(viewCode).toMatch(/:\s*undefined\s*\}/);
  });

  it("一括操作バーも canDelete で閉じる", () => {
    expect(viewCode).toContain("{canDelete && selectedVisibleIds.length > 0 &&");
  });

  it("行の削除ボタンは canDelete が false なら描画しない (disabled で残さない)", () => {
    expect(actionsCode).not.toContain("useIsAdmin");
    expect(actionsCode).toContain("{canDelete ? (");
    expect(actionsCode).not.toContain("denyDelete");
  });

  it("canDelete はサーバ (stores-table.tsx) で profile.role から決まる", () => {
    expect(tableCode).toContain("getCurrentProfile");
    // role のキャッシュ版は使わない (db:set-role が updateTag を発火しないため陳腐化する)
    expect(tableCode).not.toContain("getProfileById");
    expect(tableCode).toMatch(/role === "admin"/);
    expect(tableCode).toMatch(/canDelete=\{isAdmin\}/);
  });
});

describe("D: 0 件時の案内", () => {
  it("一覧ビューは isFiltered で案内を切り替える", () => {
    expect(viewCode).toContain("emptyState={buildEmptyState(isFiltered)}");
  });

  it("絞り込みの有無はサーバで判定して渡す", () => {
    expect(tableCode).toContain("hasAnyProgressFilter");
    expect(tableCode).toContain("isFiltered={hasAnyProgressFilter(filter)}");
    // 解決後の filter を使うとキーの有無は同じだが、意図を素の filter に固定しておく
    expect(tableCode).not.toContain("hasAnyProgressFilter(resolvedFilter)");
  });
});

describe("C: sales=me の解決", () => {
  it("セッションが無い場合に 'none' (未担当) へフォールバックしない", () => {
    expect(tableCode).toMatch(/filter\.sales === "me"/);
    expect(tableCode).toContain("NO_SESSION_SALES_SENTINEL");
    // `?? "none"` のような取り違えを禁止する
    expect(tableCode).not.toMatch(/\?\?\s*"none"/);
  });

  it("sentinel はどの UUID とも一致しない値である", () => {
    expect(tableCode).toMatch(
      /const NO_SESSION_SALES_SENTINEL = "__no-session__"/,
    );
  });
});

describe("D: 狭幅カードビュー (#234)", () => {
  it("カードも行クリックと同じ storeDetailHref を使う", () => {
    // 別々に組み立てると「押した場所で飛び先が変わる」事故になる。
    // 表の店舗名リンクとカードの 2 箇所で使われる。
    expect(viewCode.split("storeDetailHref(r)").length - 1).toBeGreaterThanOrEqual(2);
  });

  it("カードの削除ボタンもサーバ確定の canDelete で出し分ける", () => {
    expect(viewCode).toContain("canDelete={canDelete}");
  });

  it("カードリストにラベルを与える", () => {
    expect(viewCode).toContain("カード表示");
  });

  it('カードリストは role="list" を明示し、偽テーブルを作らない', () => {
    // Tailwind preflight の list-style: none で Safari + VoiceOver がリストの
    // セマンティクスを失うため role で復元する。狭幅で role="table" は使わない
    // (2〜3 項目のカードで列見出しを読み上げるのはノイズ)。
    expect(dataTableCode).toContain('role="list"');
    expect(dataTableCode).not.toContain('role="table"');
  });

  it("表とカードは CSS だけで排他に出し分ける (JS の viewport 判定を使わない)", () => {
    // PPR の静的シェルは viewport を知らないため、JS 判定だと hydration 後に
    // DOM が入れ替わってレイアウトシフトとフォーカス喪失が起きる。
    expect(dataTableCode).toContain("resolveViewSwitchClasses");
    expect(dataTableCode).not.toContain("matchMedia");
    expect(dataTableCode).not.toContain("useMediaQuery");
  });
});
