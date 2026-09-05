/**
 * 件数カードの列ラダーと placeholder の高さに使うクラスから、実際に CSS が生成される
 * ことを**本物の Tailwind と本物の `app/globals.css`** で確かめる (#265)。
 *
 * CI は `next build` を持たないため CSS 生成はゲートされていない。ここが壊れると
 * 症状は「768px で潰れたまま」「placeholder の高さが 0」= 変更前と同じ壊れ方に戻る。
 */

import { describe, expect, it } from "vitest";
import { buildCss, normalize } from "./support/build-css";

describe("件数カードのクラスの CSS 生成", () => {
  it("4 列化が lg (64rem = 1024px) から効く", async () => {
    const css = normalize(await buildCss(["grid-cols-2", "lg:grid-cols-4"]));

    expect(css).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
    expect(css).toMatch(/@media \(width >= 64rem\)[^@]*grid-template-columns: repeat\(4/);
  });

  it("md (48rem = 768px) では 4 列にならない", async () => {
    // 事故: ここが md に戻ると 1 列 111px になり、ラベルが折り返して高さが伸びる。
    const css = normalize(await buildCss(["grid-cols-2", "lg:grid-cols-4"]));
    const md = /@media \(width >= 48rem\)[^@]*grid-template-columns: repeat\(4/;

    expect(css).not.toMatch(md);
    // 対照: md 版を渡せば出ることを示す (この検査が空振りしていないことの確認)。
    expect(normalize(await buildCss(["md:grid-cols-4"]))).toMatch(md);
  });

  it("行2 の placeholder が em で高さを取る", async () => {
    // `1em` は継承した font-size (text-3xl = 1.875rem) を指すので、
    // 30 という数値を写さずに Stat の字送りへ追従する。
    const css = normalize(await buildCss(["h-[1em]", "text-3xl", "leading-none"]));

    expect(css).toContain("height: 1em");
    expect(css).toContain("font-size: var(--text-3xl)");
    expect(css).toContain("line-height: 1");
  });

  it("行1 と行3 の高さを決めるクラスが生成される", async () => {
    const css = normalize(await buildCss(["h-9", "w-9", "min-h-5", "p-5", "gap-2"]));

    expect(css).toContain("height: calc(var(--spacing) * 9)");
    expect(css).toContain("min-height: calc(var(--spacing) * 5)");
    expect(css).toContain("padding: calc(var(--spacing) * 5)");
  });

  it("存在しないクラスは何も生成しない (このテスト自体が空振りしていないことの確認)", async () => {
    const css = normalize(await buildCss(["lg:grid-cols-notavalue", "h-notavalue"]));

    expect(css).not.toContain("grid-template-columns: repeat(notavalue");
    expect(css).not.toContain("height: notavalue");
  });

  it("任意値は単位を検証されずそのまま出力される", async () => {
    // `docs/architecture/responsive.md` §4.2 の裏付け。空振り検出に任意値を使うと、
    // **不正な宣言が生成されるせいで「生成されない」の確認が成立しない**。
    // 角括弧を散文へ書いてはいけない理由でもある (dead CSS がそのまま焼き込まれる)。
    const css = normalize(await buildCss(["h-[1notaunit]"]));

    expect(css).toContain("height: 1notaunit");
  });
});
