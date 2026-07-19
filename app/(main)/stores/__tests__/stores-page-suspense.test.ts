/**
 * 店舗一覧の Suspense 構造 / 検索入力の実装ガード (#161 follow-up)。
 *
 * 次の 2 つは、いずれも `/stores` の検索・絞り込み体験を壊す。
 *
 * A. `ProgressFilterBar` ("use client") を **key 付き** Suspense の内側に置くと、
 *    filter/sort が変わるたびに境界ごと作り直されてコンポーネントが再マウントされ、
 *    絞り込みパネルの開閉状態 (useState) がリセットされ、バーが一瞬 fallback になる。
 * B. 検索 `<Input>` に URL 由来の `key={q}` を付けると、debounce 自身が push した
 *    URL 変更で key が変わって `<input>` が再マウントされ、フォーカスと caret が飛び、
 *    push 〜 commit の間に打った文字が消える。
 *
 * React component テスト環境 (Testing Library 等) がリポジトリに未導入で、
 * 新規依存の追加も避けるため、area-search-no-deep-research.test.ts と同様に
 * ソースレベルで機械的に検証する。
 */

import { beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

let pageSource: string;
let filterBarSource: string;
/** コメントを除いた実コード。旧実装を説明する JSDoc に誤ヒットしないようにする。 */
let filterBarCode: string;

/** ブロックコメント / 行コメントを取り除く (文字列内の // は本ファイルの用途では出現しない)。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

beforeAll(async () => {
  pageSource = await readFile(
    path.join(process.cwd(), "app/(main)/stores/page.tsx"),
    "utf8",
  );
  filterBarSource = await readFile(
    path.join(process.cwd(), "app/(main)/stores/progress/_components/progress-filter-bar.tsx"),
    "utf8",
  );
  filterBarCode = stripComments(filterBarSource);
});

describe("A: StoresPage の Suspense 構造", () => {
  it("key 付き Suspense の内側に ProgressFilterBar を置かない", () => {
    const keyedStart = pageSource.indexOf("<Suspense key=");
    expect(keyedStart).toBeGreaterThan(-1);
    const keyedBlock = pageSource.slice(keyedStart);
    const closing = keyedBlock.indexOf("</Suspense>");
    expect(closing).toBeGreaterThan(-1);
    expect(keyedBlock.slice(0, closing)).not.toContain("ProgressFilterBar");
  });

  it("ProgressFilterBar は key を持たない Suspense 配下でマウントする", () => {
    expect(pageSource).toContain("<Suspense fallback={<ProgressFilterBarFallback />}>");
    expect(pageSource).toContain("<ProgressFilterBarSlot />");
  });

  it("一覧は filter/sort ごとに fallback を出す keyed Suspense に置く", () => {
    expect(pageSource).toMatch(/<Suspense key=\{JSON\.stringify\(\{ filter, sort \}\)\}/);
    const keyedBlock = pageSource.slice(pageSource.indexOf("<Suspense key="));
    expect(keyedBlock.slice(0, keyedBlock.indexOf("</Suspense>"))).toContain("<StoresTable");
  });

  it("ページ本体で getAllProfiles を await しない (シェルのブロック防止)", () => {
    // await は Suspense 境界の内側 (ProgressFilterBarSlot) にのみ存在する
    const body = pageSource.slice(pageSource.indexOf("export default async function StoresPage"));
    const slot = body.indexOf("async function ProgressFilterBarSlot");
    expect(slot).toBeGreaterThan(-1);
    expect(body.slice(0, slot)).not.toContain("await getAllProfiles");
  });
});

describe("B: 検索入力の実装", () => {
  it("URL 由来の key を <Input> に付けない (自 push で再マウントされるため)", () => {
    expect(filterBarCode).not.toContain("key={q");
  });

  it("入力値をローカル state で制御する", () => {
    expect(filterBarCode).toContain("value={term}");
    expect(filterBarCode).not.toContain("defaultValue={q}");
  });

  it("自分が push した値を記録し、外部由来の URL 変更とだけ同期する", () => {
    expect(filterBarCode).toContain("pushedTermRef");
  });

  it("アンマウント時に debounce タイマーを解除する", () => {
    expect(filterBarCode).toContain("clearTimeout(debounceRef.current)");
    // cleanup を返す useEffect が存在すること
    expect(filterBarCode).toMatch(/useEffect\(\s*\(\)\s*=>\s*\(\)\s*=>/);
  });
});
