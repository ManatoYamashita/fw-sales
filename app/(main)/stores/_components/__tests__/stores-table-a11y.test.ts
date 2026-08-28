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
