/**
 * `docs/architecture/responsive.md` が挙げるファイル参照が実在することを固定する。
 *
 * この文書は §7 で「数値と機構固有の契約はソース側が単一の真実。ここからは
 * **どこを見ればよいか**だけを指す」と宣言している。索引は指す先が消えたり移動したりした
 * 瞬間に価値を失うが、**Markdown の中の壊れたパスは typecheck も lint も何も言わない**。
 * §5 の層ごとの実例表を足した (#225 Phase 0) ことで参照は 20 件を超えており、
 * 手動確認では追随できない。
 *
 * 検査するのは実在だけで、内容の正しさは見ない。それは各テスト自身の仕事。
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const DOC = "docs/architecture/responsive.md";

/** 走査から外すディレクトリ。`.claude` は他ブランチのファイルツリーが展開されうる。 */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".claude",
  ".vercel",
]);

/** 索引が指しうる拡張子。 */
const REFERENCED_EXTENSIONS = /\.(tsx?|css|mjs)$/;

function collectFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(path.join(dir, entry.name));
      } else if (REFERENCED_EXTENSIONS.test(entry.name)) {
        found.push(path.join(dir, entry.name));
      }
    }
  };
  walk(".");
  return found;
}

const doc = readFileSync(path.join(ROOT, DOC), "utf8");
/** バッククォートで囲まれたトークン。 */
const quoted = [...new Set(doc.match(/`[^`\n]+`/g) ?? [])].map((t) => t.slice(1, -1));
/** ワイルドカードを含むものは総称なので対象外。 */
const candidates = quoted.filter(
  (t) => REFERENCED_EXTENSIONS.test(t) && !t.includes("*") && !t.includes(" "),
);
const withDirectory = candidates.filter((t) => t.includes("/"));
const bareFilenames = candidates.filter((t) => !t.includes("/"));

const files = collectFiles();
const byBasename = new Map<string, string[]>();
for (const f of files) {
  const base = f.split("/").at(-1)!;
  byBasename.set(base, [...(byBasename.get(base) ?? []), f]);
}

describe("responsive.md の索引", () => {
  it("参照を抽出できている (この走査が空振りしていないことの確認)", () => {
    // 抽出が 0 件なら以下の it.each が 1 度も回らず、全部が空虚に green になる。
    expect(withDirectory.length).toBeGreaterThan(0);
    expect(bareFilenames.length).toBeGreaterThan(0);
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(withDirectory)("%s が実在する", (ref) => {
    expect(files, `${DOC} が指す ${ref} が無い`).toContain(ref);
  });

  it.each(bareFilenames)("%s が一意に解決する", (ref) => {
    // ディレクトリ無しで引用されたファイル名は、同名が 2 つあるとどれを指すか
    // 読者が判断できない。増えたらパス付きで書き直すこと。
    expect(byBasename.get(ref) ?? [], `${DOC} が指す ${ref} が一意でない`).toHaveLength(1);
  });
});
