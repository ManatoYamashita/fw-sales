/**
 * 画面遷移中の表示を固定する (#326)。
 *
 * - `(main)` 配下の各画面は、自分の骨組みを写した loading.tsx を持つ
 *   (親の loading.tsx に落ちると、別の画面の骨組みが一瞬出る)
 * - loading.tsx はスピナーと文言だけにせず、Skeleton で骨組みを出す
 * - 進行バーは (main) レイアウトの Suspense の内側に置く
 *   (useSearchParams を読むため、外に出すと静的シェルの prerender が落ちる)
 *
 * 判定は import 宣言と JSX の構文木で行う。コメント中の名前には反応しない。
 */

import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/** loading.tsx を持たなくてよい画面と、その理由。 */
const EXEMPT_PAGES: Record<string, string> = {
  "app/(main)/stores": "page 本体が静的シェルで、表は局所の Suspense でスケルトンを出す",
  "app/(main)/dashboard": "page 本体が静的シェルで、各区画を局所の Suspense でスケルトンにしている (proxy で無効化中)",
  "app/(main)/stores/progress": "redirect するだけの互換ルートで、描画するものが無い",
  "app/(main)/deals/new": "redirect するだけの互換ルートで、描画するものが無い",
};

function parse(source: string): ts.SourceFile {
  return ts.createSourceFile("x.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function importedModules(source: string): string[] {
  return parse(source)
    .statements.filter(ts.isImportDeclaration)
    .map((s) => (s.moduleSpecifier as ts.StringLiteral).text);
}

export function loadingViolations(source: string): string[] {
  const modules = importedModules(source);
  const out: string[] = [];
  if (modules.includes("@/components/ui/spinner")) out.push("spinner");
  if (!modules.includes("@/components/ui/skeleton")) out.push("no-skeleton");
  return out;
}

const pageDirs = execSync("git ls-files 'app/(main)/**/page.tsx'", { encoding: "utf8" })
  .trim()
  .split("\n")
  .map((f) => path.dirname(f));

describe("loadingViolations の検知力", () => {
  it("#326 以前の店舗詳細の loading.tsx (原文) を検出する", () => {
    const before = `import { Spinner } from "@/components/ui/spinner";

export default function StoreLoading() {
  return (
    <div className="flex items-center justify-center py-24 text-muted-foreground gap-2">
      <Spinner size="lg" /> 店舗情報を読み込み中…
    </div>
  );
}`;
    expect(loadingViolations(before)).toEqual(["spinner", "no-skeleton"]);
  });

  it("コメントで名前に触れただけでは反応しない", () => {
    const source = `// 以前は "@/components/ui/spinner" を使っていた
import { Skeleton } from "@/components/ui/skeleton";`;
    expect(loadingViolations(source)).toEqual([]);
  });
});

describe("(main) 配下の loading.tsx", () => {
  it("走査対象の画面が空でない", () => {
    expect(pageDirs.length).toBeGreaterThan(10);
  });

  it("除外表に載っていない画面は、自分の loading.tsx を持つ", () => {
    const missing = pageDirs.filter(
      (dir) => !(dir in EXEMPT_PAGES) && !existsSync(path.join(dir, "loading.tsx")),
    );
    expect(missing).toEqual([]);
  });

  it("除外表に、もう存在しない画面や loading.tsx を持つ画面が残っていない", () => {
    for (const dir of Object.keys(EXEMPT_PAGES)) {
      expect(pageDirs).toContain(dir);
      expect(existsSync(path.join(dir, "loading.tsx"))).toBe(false);
    }
  });

  it("すべての loading.tsx がスピナーではなくスケルトンで骨組みを出す", () => {
    const files = execSync("git ls-files 'app/**/loading.tsx'", { encoding: "utf8" })
      .trim()
      .split("\n");
    expect(files.length).toBeGreaterThan(10);
    const violations = files.flatMap((f) =>
      loadingViolations(readFileSync(f, "utf8")).map((v) => `${f}: ${v}`),
    );
    expect(violations).toEqual([]);
  });
});

describe("進行バーの配置", () => {
  it("(main) レイアウトの Suspense の直下に NavigationProgress がある", () => {
    const sf = parse(readFileSync("app/(main)/layout.tsx", "utf8"));
    const parents: string[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isJsxSelfClosingElement(node) && node.tagName.getText() === "NavigationProgress") {
        const parent = node.parent;
        parents.push(ts.isJsxElement(parent) ? parent.openingElement.tagName.getText() : "?");
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    expect(parents).toEqual(["Suspense"]);
  });
});
