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
 */
const ROOT = path.resolve(import.meta.dirname, "../../../..");

export async function buildCss(candidates: string[]): Promise<string> {
  const entry = path.join(ROOT, "app/globals.css");
  const compiler = await compile(await readFile(entry, "utf8"), {
    base: path.dirname(entry),
    loadStylesheet: async (id: string, base: string) => {
      const resolved =
        id === "tailwindcss"
          ? path.join(ROOT, "node_modules/tailwindcss/index.css")
          : id.startsWith(".")
            ? path.resolve(base, id)
            : path.join(ROOT, "node_modules", id);
      return {
        path: resolved,
        base: path.dirname(resolved),
        content: await readFile(resolved, "utf8"),
      };
    },
  });
  return compiler.build(candidates);
}

/** 空白の揺れを潰して部分一致しやすくする。 */
export function normalize(css: string): string {
  return css.replace(/\s+/g, " ");
}
