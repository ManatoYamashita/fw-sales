/**
 * 営業資産生成の入口が 1 か所であることを固定する (Issue #300)。
 *
 * #300 以前は店舗詳細「AI 分析」タブと `/research/[storeId]` の 2 画面が
 * `generateSalesAssetsAction` を呼び、入力欄の名前も役割も違っていた。
 * 生成 UI を `/research/[storeId]` の `SalesAssetSection` に集約したので、
 * action を import する画面側のファイルがそれ 1 件であることを検査する。
 * 別の場所から生成させたいときは、生成 UI を足すのではなくそこへ遷移させること。
 *
 * import の抽出は正規表現ではなく `ts.preProcessFile` に任せる。コメント中の
 * モジュール名 (撤去の経緯を書いた JSDoc など) に自己ヒットせず、静的 import・
 * `export ... from`・動的 `import()` のすべてを拾う。
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../..");
const SCAN_DIRS = ["app", "components"];
const ACTION_MODULE = "@/lib/actions/sales-assets-actions";
const SINGLE_ENTRY = "app/(main)/research/[storeId]/_components/sales-asset-section.tsx";

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue;
      out.push(...listSourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** ファイルが import するモジュール指定子 (相対指定は `@/` 形式へ正規化)。 */
function importedModules(source: string, filePath: string): string[] {
  const { importedFiles } = ts.preProcessFile(source, true, true);
  return importedFiles.map(({ fileName }) => {
    if (!fileName.startsWith(".")) return fileName;
    const resolved = path.relative(ROOT, path.resolve(path.dirname(filePath), fileName));
    return `@/${resolved.split(path.sep).join("/")}`;
  });
}

function importsAction(source: string, filePath: string): boolean {
  return importedModules(source, filePath).some(
    (m) => m === ACTION_MODULE || m === `${ACTION_MODULE}.ts`,
  );
}

describe("営業資産生成の単一入口 (#300)", () => {
  it(`${ACTION_MODULE} を import する画面側ファイルは ${SINGLE_ENTRY} だけ`, () => {
    const importers = SCAN_DIRS.flatMap((dir) => listSourceFiles(path.join(ROOT, dir)))
      .filter((file) => importsAction(readFileSync(file, "utf8"), file))
      .map((file) => path.relative(ROOT, file).split(path.sep).join("/"));
    expect(importers).toEqual([SINGLE_ENTRY]);
  });

  describe("検出器そのものの検知力", () => {
    const file = path.join(ROOT, "app/(main)/stores/[id]/_components/x.tsx");

    it.each([
      ["静的 import", `import { generateSalesAssetsAction } from "${ACTION_MODULE}";`],
      ["名前空間 import", `import * as a from "${ACTION_MODULE}";`],
      ["再 export", `export { generateSalesAssetsAction } from "${ACTION_MODULE}";`],
      ["動的 import", `const m = await import("${ACTION_MODULE}");`],
      ["相対 import", `import { generateSalesAssetsAction } from "../../../../../lib/actions/sales-assets-actions";`],
    ])("%s を検出する", (_label, source) => {
      expect(importsAction(source, file)).toBe(true);
    });

    it("コメント中のモジュール名には反応しない", () => {
      const source = `// 旧: import { generateSalesAssetsAction } from "${ACTION_MODULE}";\n/** ${ACTION_MODULE} は撤去 */\nexport const x = 1;`;
      expect(importsAction(source, file)).toBe(false);
    });
  });
});
