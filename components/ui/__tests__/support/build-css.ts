import { readFile } from "node:fs/promises";
import path from "node:path";
import { compile } from "tailwindcss";

/**
 * **本物の Tailwind と本物の `app/globals.css`** でクラス候補をコンパイルするヘルパ。
 *
 * ## なぜこれが要るのか
 * CI (`.github/workflows/ci.yml`) は typecheck / lint / vitest だけで `next build` を
 * 走らせないため、CSS の生成は現状まったくゲートされていない。そして生成失敗は
 * 無言で、症状は「スタイルが効かない」だけ。マップのタイポ、Tailwind アップグレードに
 * よる variant 構文の変更、`@theme` の破壊を、ここで一括して捕まえる。
 *
 * `compile()` は Tailwind の準公開 API。ここが壊れたら「Tailwind の内部が変わった」
 * シグナルとして扱い、生成結果を実機で確認したうえで追随すること。
 *
 * ソースファイルの走査は行わず候補クラスを直接渡すので、「そのクラスがソースに
 * リテラルで書かれているか」は各テストのソース逐語検査が担当する (分業)。
 * **走査そのもの**を検査したい場合は `tailwind-sources.ts` を使う。
 */
export const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");

/** Tailwind の entry CSS。走査設定 (`@source`) もここが持つ。 */
export const ENTRY_CSS = path.join(REPO_ROOT, "app/globals.css");

/**
 * `@import` を解決する。bundler を通さずに `compile()` を直接呼ぶため、
 * パッケージ名は `node_modules` へ、相対パスは呼び出し元からの相対で引く。
 */
export async function loadStylesheet(id: string, base: string) {
  const resolved =
    id === "tailwindcss"
      ? path.join(REPO_ROOT, "node_modules/tailwindcss/index.css")
      : id.startsWith(".")
        ? path.resolve(base, id)
        : path.join(REPO_ROOT, "node_modules", id);
  return {
    path: resolved,
    base: path.dirname(resolved),
    content: await readFile(resolved, "utf8"),
  };
}

/** `app/globals.css` をコンパイルする。走査設定を読みたい場合は戻り値の `root` / `sources` を使う。 */
export async function compileEntry() {
  return compile(await readFile(ENTRY_CSS, "utf8"), {
    base: path.dirname(ENTRY_CSS),
    loadStylesheet,
  });
}

export async function buildCss(candidates: string[]): Promise<string> {
  const compiler = await compileEntry();
  return compiler.build(candidates);
}

/** 空白の揺れを潰して部分一致しやすくする。 */
export function normalize(css: string): string {
  return css.replace(/\s+/g, " ");
}
