/**
 * ネイティブの `<select>` が残っていないことを固定する (#334)。
 *
 * プルダウンは共通 `Select` に統一した。ネイティブの `<select>` は開くとブラウザ /
 * OS 標準の候補パネルを出すので、新しい画面で生の `<select>` を書くと方針が崩れる。
 *
 * 走査が空振りしていないことは negative control で別に立証する
 * (`docs/architecture/responsive.md` §5「ガードは negative control で検知力を実証してから出す」)。
 * 置き換え前に実際に書かれていた行の原文と、要素を作る 4 形 (静的リテラル / 式 /
 * テンプレートリテラル / 変数参照) をそれぞれ落とせること、説明コメントや共通
 * `Select` へは反応しないことを確かめる。
 */

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findNativeSelects } from "./support/native-select-scan";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const SCAN_DIRS = ["app", "components", "lib"];

async function collectSources(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      // テストは negative control の needle を持つので本番コードの走査から外す。
      if (entry.name === "__tests__") continue;
      files.push(...(await collectSources(fullPath)));
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

describe("リポジトリにネイティブの <select> が残っていない", () => {
  it("app / components / lib の .ts(x) を走査して 0 件", async () => {
    const files = (
      await Promise.all(SCAN_DIRS.map((dir) => collectSources(path.join(ROOT, dir))))
    ).flat();
    // 走査範囲が空になって緑になる、を防ぐ。
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((f) => f.endsWith(path.join("components", "ui", "select.tsx")))).toBe(true);

    const hits: string[] = [];
    for (const file of files) {
      const source = await readFile(file, "utf8");
      for (const hit of findNativeSelects(source, file)) {
        hits.push(`${path.relative(ROOT, file)}:${hit.line} [${hit.form}] ${hit.text}`);
      }
    }
    expect(hits).toEqual([]);
  });
});

describe("negative control: 置き換え前の原文を落とす", () => {
  it("旧 components/ui/select.tsx の描画", () => {
    const source = [
      "export function Select({ className, children, width, ...props }: SelectProps) {",
      "  return (",
      "    <select",
      "      className={cn(",
      '        "flex appearance-none rounded-md border border-input bg-background px-3 pr-8",',
      "        className,",
      "      )}",
      "      {...props}",
      "    >",
      "      {children}",
      "    </select>",
      "  );",
      "}",
    ].join("\n");
    expect(findNativeSelects(source).map((h) => h.form)).toEqual(["jsx"]);
  });

  it("旧 components/ui/data-table-sort-select.tsx の生の select", () => {
    const source = [
      "<div>",
      "  <select",
      '    id="card-sort-key"',
      '    value={selected ? selected.sortKey : ""}',
      "    onChange={(e) => {",
      "      const opt = options.find((o) => o.sortKey === e.currentTarget.value);",
      "    }}",
      "  >",
      '    <option value="" disabled>並び替え</option>',
      "  </select>",
      "</div>",
    ].join("\n");
    expect(findNativeSelects(source)).toHaveLength(1);
    expect(findNativeSelects(source)[0]?.line).toBe(2);
  });
});

describe("negative control: 要素を作る 4 形を落とす", () => {
  it("静的な文字列リテラル", () => {
    expect(findNativeSelects('createElement("select", { name: "x" })')[0]?.form).toBe(
      "literal",
    );
    expect(findNativeSelects("React.createElement('select')")[0]?.form).toBe("literal");
    expect(findNativeSelects('jsx("select", {})')[0]?.form).toBe("literal");
    expect(findNativeSelects('document.createElement("SELECT")')[0]?.form).toBe(
      "literal",
    );
  });

  it("式の中のリテラル", () => {
    expect(
      findNativeSelects('createElement(multiple ? "select" : "input", props)')[0]?.form,
    ).toBe("expression");
  });

  it("テンプレートリテラル", () => {
    expect(findNativeSelects("createElement(`select`)")[0]?.form).toBe("template");
  });

  it("変数参照 (JSX の動的タグと createElement の引数)", () => {
    const jsx = 'const Tag = "select";\nexport const X = () => <Tag name="a" />;';
    expect(findNativeSelects(jsx).map((h) => h.form)).toEqual(["variable"]);
    const call = 'const tag = native ? "select" : "div";\ncreateElement(tag);';
    expect(findNativeSelects(call).map((h) => h.form)).toEqual(["variable"]);
  });
});

describe("誤検出しない", () => {
  it("説明コメント・JSDoc の <select> には反応しない", () => {
    const source = [
      "/** ネイティブの `<select>` は一致する `<option>` が無いと先頭を表示する。 */",
      "// <select> を使わない",
      "export const a = 1;",
    ].join("\n");
    expect(findNativeSelects(source)).toEqual([]);
  });

  it("共通 Select と、要素を作らない文字列には反応しない", () => {
    const source = [
      'import { Select } from "@/components/ui/select";',
      'const mode = "select";',
      'const isNative = ["input", "select", "textarea"].includes(type);',
      'export const X = () => <Select width="full" options={[]} />;',
      'db.select().from(stores);',
    ].join("\n");
    expect(findNativeSelects(source)).toEqual([]);
  });
});
