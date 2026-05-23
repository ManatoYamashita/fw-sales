/**
 * area-search 非露出ガード (deep-research-pipeline spec #43, Task 6.3 軽量代替)
 *
 * `requirements.md §1.4` で「エリア検索結果一覧画面が表示される際、Deep Research の
 * キュー登録アクションを露出させない」ことが必須となっている。
 *
 * Playwright/Cypress 環境未導入のため、ソースレベルで以下を機械的に検証する:
 * - エリア検索コンポーネント群が Deep Research の Action / Component を一切 import しない
 * - 画面文字列に「Deep Research」CTA が含まれない
 *
 * 関連: requirements.md §1.4, §7.2
 */

import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

const REPO_ROOT = process.cwd();

const AREA_SEARCH_FILES = [
  "app/(main)/stores/new/_components/area-search-results.tsx",
  "app/(main)/stores/new/_components/place-result-list.tsx",
];

const FORBIDDEN_PATTERNS = [
  "enqueueDeepResearchAction",
  "retryDeepResearchAction",
  "DeepResearchEnqueueButton",
  "DeepResearchSection",
  "DeepResearchReportView",
  "Deep Research を実行",
];

describe("area-search に Deep Research CTA が露出しない (R1.4)", () => {
  it.each(AREA_SEARCH_FILES)(
    "%s に Deep Research 関連の import / CTA 文字列がない",
    async (relativePath) => {
      const absPath = path.join(REPO_ROOT, relativePath);
      const content = await readFile(absPath, "utf8");
      for (const pattern of FORBIDDEN_PATTERNS) {
        expect(content, `${relativePath} に "${pattern}" が含まれています`).not.toContain(
          pattern,
        );
      }
    },
  );

  it("Deep Research セクションは店舗詳細 page.tsx でのみ参照される", async () => {
    const detailPagePath = path.join(
      REPO_ROOT,
      "app/(main)/stores/[id]/page.tsx",
    );
    const content = await readFile(detailPagePath, "utf8");
    // 店舗詳細では DeepResearchSection をマウントしている (Task 5.4)
    expect(content).toContain("DeepResearchSection");
  });
});
