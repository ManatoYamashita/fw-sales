/**
 * 設定画面の件数カードが、本体・Suspense fallback・`loading.tsx` の 3 箇所で
 * **同じ列ラダーと同じ高さ**を使うこと (#265) を固定する。
 *
 * ## 変更前は何が壊れていたか
 *
 * 3 箇所が同じ列ラダー (4 列化が md) を逐語コピーし、placeholder だけ高さ 88px を
 * 任意値で固定していた。実体は 144px なので、データ到着時に **56px 跳ねていた**。
 * さらに 768px で 4 列にすると 1 列 111px しか無く、ラベルが折り返してカード高が
 * 172px へ伸びていた。
 *
 * ## この層で見ているもの (`docs/architecture/responsive.md` §5)
 *
 * - ④ 実描画検査 — `CountsGridSkeleton` が出す class
 * - ③ 配線検査 — `page.tsx` / `loading.tsx` が定数とコンポーネントを実際に使う
 * - ① 旧リテラルが残っていない (`modal-wiring.test.ts` と同型)
 */

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { hidden } from "@/components/ui/__tests__/support/scanner-hidden";
import {
  COUNTS_GRID_CELLS,
  COUNTS_GRID_CLASS,
  CountsGridSkeleton,
} from "../counts-grid";

const SETTINGS = path.resolve(import.meta.dirname, "../..");
const read = (file: string) => readFile(path.join(SETTINGS, file), "utf8");

/**
 * 旧リテラルの needle。**走査に拾わせないため実行時に連結する** (#265)。
 * 逐語で書くと、消したはずのクラスをこのガード自身が本番 CSS へ延命させる
 * (`components/ui/__tests__/support/scanner-hidden.ts`)。
 */
const STALE = [hidden("md:grid-", "cols-4"), hidden("h-[", "88px]")];

describe("列ラダー", () => {
  it("768px では 4 列にしない", () => {
    // md (768px) はサイドバー出現でコンテンツが 528px へ落ちる帯。
    // ここで 4 列にすると 1 列 111px しか無く、ラベルが折り返して高さが伸びる。
    const tokens = COUNTS_GRID_CLASS.split(/\s+/);

    expect(tokens).not.toContain(STALE[0]);
    expect(tokens).toContain("lg:grid-cols-4");
  });

  it("375px は 2 列のまま (base を 1 列へ落とさない)", () => {
    // 375px でのセルは 166px。ラベルの溢れも切り詰めも実測で無かったので、
    // 1 列にして縦に伸ばす理由が無い。
    expect(COUNTS_GRID_CLASS.split(/\s+/)).toContain("grid-cols-2");
  });
});

describe("placeholder と本体が同じものを見る", () => {
  it("CountsGridSkeleton のルートが COUNTS_GRID_CLASS そのもの", () => {
    const html = renderToStaticMarkup(<CountsGridSkeleton />);
    const match = /^<div class="([^"]*)"/.exec(html);

    expect(match?.[1], "ルートの <div> を抽出できていない").toBeTypeOf("string");
    expect(match![1]).toBe(COUNTS_GRID_CLASS);
  });

  it("placeholder の枚数が本体の Stat の数と一致する", async () => {
    // 事故: 枚数がずれると、行数が変わってやはり跳ねる。
    const page = await read("page.tsx");
    const stats = (page.match(/<Stat\b/g) ?? []).length;

    expect(stats, "page.tsx に <Stat> が見つからない").toBeGreaterThan(0);
    expect(stats).toBe(COUNTS_GRID_CELLS);
  });

  it("placeholder が高さを px で持たない", () => {
    // 高さは StatSkeleton が Stat と同じ構造で作る。px の任意値が現れたら、
    // また 2 つの真実ができたということ (settings の 88px / dashboard の 112px が
    // まさにそれだった)。
    const html = renderToStaticMarkup(<CountsGridSkeleton />);

    expect(html).not.toMatch(/\bh-\[\d+(px|rem)\]/);
    // 唯一の任意値は行 2 の `h-[1em]`。1em は継承した font-size を指すので、
    // 数値ではなく Stat 側の字送りへの参照になっている。
    expect(html).toContain("h-[1em]");
  });
});

describe("配線", () => {
  it.each([
    ["page.tsx", ["COUNTS_GRID_CLASS", "CountsGridSkeleton"]],
    ["loading.tsx", ["CountsGridSkeleton"]],
  ])("%s が counts-grid から取り込んで実際に使う", async (file, names) => {
    const source = await read(file);

    expect(source).toContain('from "./_components/counts-grid"');
    for (const name of names) {
      // import 文と使用箇所で最低 2 回。import しただけで使っていない形を落とす。
      expect(
        (source.match(new RegExp(`\\b${name}\\b`, "g")) ?? []).length,
        `${file} が ${name} を使っていない`,
      ).toBeGreaterThanOrEqual(2);
    }
  });

  it("旧リテラルが settings 配下に残っていない", async () => {
    // 事故: 3 箇所のうち 1 つでも取り残すと、そこだけ 768px で潰れ続ける。
    // negative control は、この文字列を page.tsx か loading.tsx へ戻すこと。
    const files: string[] = [];
    const walk = async (dir: string) => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "__tests__") continue;
          await walk(full);
        } else if (full.endsWith(".tsx")) {
          files.push(full);
        }
      }
    };
    await walk(SETTINGS);

    expect(files.length, "settings 配下の .tsx を集められていない").toBeGreaterThan(3);

    const stale: string[] = [];
    for (const file of files) {
      const source = await readFile(file, "utf8");
      if (STALE.some((needle) => source.includes(needle))) {
        stale.push(path.relative(SETTINGS, file));
      }
    }
    expect(stale).toEqual([]);
  });
});
