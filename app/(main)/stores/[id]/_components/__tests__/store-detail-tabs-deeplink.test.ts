/**
 * 店舗詳細タブの deep link 契約ガード (Issue #110)。
 *
 * `/stores/[id]?tab=ai` / `?tab=progress` は、調査ページや営業進捗一覧からの
 * 遷移先として使われてきた URL 契約であり、ブックマークも存在しうる。
 * ところがこの初期タブ選択にはテストが一本も無く、#110 で隣接する
 * 死んだ `#deep-research` アンカー処理を削除する際に、`initialTab` の
 * 三項演算子まで巻き込んで壊す事故が起こりうる。本ファイルでその契約を固定する。
 *
 * React component テスト環境 (Testing Library 等) がリポジトリに未導入で、
 * 新規依存の追加も避けるため、`app/(main)/stores/__tests__/stores-page-suspense.test.ts`
 * と同様にソースレベルで機械的に検証する。
 */

import { beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

let tabsSource: string;

beforeAll(async () => {
  tabsSource = await readFile(
    path.join(
      process.cwd(),
      "app/(main)/stores/[id]/_components/store-detail-tabs.tsx",
    ),
    "utf8",
  );
});

describe("store-detail-tabs の初期タブ deep link", () => {
  it("`tab` クエリを useSearchParams から読む", () => {
    expect(tabsSource).toMatch(/useSearchParams\(\)/);
    expect(tabsSource).toMatch(/searchParams\.get\("tab"\)/);
  });

  it("`?tab=ai` を AI 分析タブへ解決する", () => {
    expect(tabsSource).toMatch(/tabParam === "ai" \? "ai"/);
  });

  it("`?tab=progress` を営業進捗タブへ解決する", () => {
    expect(tabsSource).toMatch(/tabParam === "progress" \? "progress"/);
  });

  it("`tab` 未指定・未知の値は基本情報タブへフォールバックする", () => {
    expect(tabsSource).toMatch(/: "basic";/);
  });

  it("導出した initialTab を Tabs の defaultValue に渡す (導出したまま使い忘れない)", () => {
    expect(tabsSource).toMatch(/<Tabs defaultValue=\{initialTab\}/);
  });
});
