/**
 * area-search 非露出ガード (初出: deep-research-pipeline spec #43, Task 6.3 軽量代替)
 *
 * `requirements.md §1.4` の「エリア検索結果一覧画面が表示される際、調査の
 * キュー登録アクションを露出させない」を守るためのガード。
 *
 * 旧 Deep Research 自動パイプラインは #110 で全撤去済みだが、
 * **「エリア検索の画面から店舗調査を直接起動させない」という UX 方針は現行も有効**
 * (エリア検索は候補の発見と登録に責務を絞り、調査は `/research` 側で行う)。
 * そのため本ファイルはガードとして残し、監視対象に現行シンボルを加えている。
 *
 * Playwright/Cypress 環境未導入のため、ソースレベルで以下を機械的に検証する:
 * - エリア検索コンポーネント群が調査の Action / Component を一切 import しない
 * - 画面文字列に調査起動の CTA が含まれない
 *
 * 関連: requirements.md §1.4, §7.2 (いずれも履歴。spec は phase: removed)
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
  // 現行 (AI 店舗調査 / #180)。エリア検索から調査を直接起動させない
  "startResearchRunAction",
  // 旧 Deep Research 自動パイプライン (#43)。撤去済みだが再導入検知として維持
  "enqueueDeepResearchAction",
  "retryDeepResearchAction",
  "DeepResearchEnqueueButton",
  "DeepResearchSection",
  "DeepResearchReportView",
  "Deep Research を実行",
];

describe("area-search に調査起動の CTA が露出しない (R1.4)", () => {
  it.each(AREA_SEARCH_FILES)(
    "%s に調査関連の import / CTA 文字列がない",
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
});
