import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compile } from "tailwindcss";
import {
  COLUMN_HIDE_CLASSES,
  COLUMN_HIDE_CLASSES_WITH_SELECTION,
  DATA_TABLE_CONTAINER_CLASS,
  VIEW_SWITCH_CARD_CLASSES,
  VIEW_SWITCH_TABLE_CLASSES,
} from "../data-table-responsive";

/**
 * 段階表示クラスから実際に CSS が生成されることを、**本物の Tailwind と本物の
 * `app/globals.css`** で確かめる (#220)。
 *
 * ## なぜこのテストが要るのか
 * CI (`.github/workflows/ci.yml`) は typecheck / lint / vitest だけで `next build` を
 * 走らせないため、CSS の生成は現状まったくゲートされていない。そして生成失敗は
 * 無言で、症状は「横スクロールが消えない」だけ。マップのタイポ、Tailwind
 * アップグレードによる variant 構文の変更、`@theme` の破壊を、ここで一括して捕まえる。
 *
 * `compile()` は Tailwind の準公開 API。ここが壊れたら「Tailwind の内部が変わった」
 * シグナルとして扱い、生成結果を実機で確認したうえで追随すること。
 */

const ROOT = path.resolve(import.meta.dirname, "../../..");

async function buildCss(candidates: string[]): Promise<string> {
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
function normalize(css: string): string {
  return css.replace(/\s+/g, " ");
}

describe("段階表示クラスの CSS 生成", () => {
  it("コンテナクラスが名前付きの inline-size コンテナを作る", async () => {
    const css = normalize(await buildCss([DATA_TABLE_CONTAINER_CLASS]));
    expect(css).toContain("container-type: inline-size");
    expect(css).toContain("container-name: data-table");
  });

  it("全閾値が data-table コンテナに対する width < N のクエリを生成する", async () => {
    const tokens = [
      ...Object.values(COLUMN_HIDE_CLASSES),
      ...Object.values(COLUMN_HIDE_CLASSES_WITH_SELECTION),
    ];
    const css = normalize(await buildCss(tokens));

    for (const token of tokens) {
      const px = /@max-\[(\d+)px\]/.exec(token)![1];
      expect(css, `${token} の container query が無い`).toContain(
        `@container data-table (width < ${px}px)`,
      );
    }
    // 隠す指定であること (display:none 以外へ化けていない)
    expect(css).toContain("display: none");
    // 14 本すべてが別々のクエリとして出る (重複キーによる取りこぼしの検出)
    const queries = new Set(
      [...css.matchAll(/@container data-table \(width < \d+px\)/g)].map((m) => m[0]),
    );
    expect(queries.size).toBe(tokens.length);
  });

  it("存在しないクラスは何も生成しない (このテスト自体が空振りしていないことの確認)", async () => {
    const css = await buildCss(["@max-[999999px]/nonexistent-container:not-a-utility"]);
    expect(normalize(css)).not.toContain("@container");
  });
});

describe("表 ⇄ カード切替クラスの CSS 生成 (#234)", () => {
  it("表側は width < N、カード側は width >= N を生成する", async () => {
    // 補集合であることを実際に生成された CSS で確かめる。
    // どちらかが生成されないと、その幅で「両方出る」に劣化する (安全側だが意図とは違う)。
    for (const key of ["false", "true"] as const) {
      const table = normalize(await buildCss([VIEW_SWITCH_TABLE_CLASSES[key]]));
      const card = normalize(await buildCss([VIEW_SWITCH_CARD_CLASSES[key]]));
      const n = key === "false" ? 640 : 688;
      expect(table).toContain(`@container data-table (width < ${n}px)`);
      expect(card).toContain(`@container data-table (width >= ${n}px)`);
      expect(table).toContain("display: none");
      expect(card).toContain("display: none");
    }
  });
});
