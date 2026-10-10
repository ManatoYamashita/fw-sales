/**
 * Skeleton がページ背景とカードの両方の上で見えることを固定する (#326)。
 *
 * 以前の既定 (`bg-muted`) はライトテーマでページ背景 (--background) と同じ
 * #f1f5f9 で、カードの外に置いた見出しやタブの骨組みが**まったく見えなかった**。
 * スケルトンは「トークン単体」ではなく「トークン × 載る面」で見え方が決まるので、
 * 両テーマ × 両方の面で、実際に合成した色の差を測る。
 */

import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Skeleton } from "../skeleton";

type Rgb = [number, number, number];

const css = readFileSync("app/globals.css", "utf8");

function token(theme: "light" | "dark", name: string): Rgb {
  const selector = theme === "light" ? ":root" : "\\.dark";
  const block = css.match(new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1];
  const value = block?.match(new RegExp(`^\\s*--${name}:\\s*(#[0-9a-fA-F]{6})`, "m"))?.[1];
  if (!value) throw new Error(`${theme} の --${name} を読めない`);
  return [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16)) as Rgb;
}

function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** `bg-<token>/<alpha>` を面の上に重ねた色。 */
function over(top: Rgb, alpha: number, surface: Rgb): Rgb {
  return top.map((c, i) => c * alpha + surface[i]! * (1 - alpha)) as Rgb;
}

/** 既定の tone の背景クラスから、重ねる色と不透明度を読む。 */
function defaultFill(): { name: string; alpha: number } {
  const html = renderToStaticMarkup(Skeleton({}));
  const match = /\bbg-([a-z-]+)(?:\/(\d+))?(?=[\s"])/.exec(html);
  if (!match) throw new Error(`背景クラスが見つからない: ${html}`);
  return { name: match[1]!, alpha: match[2] ? Number(match[2]) / 100 : 1 };
}

/**
 * 見えると言える最小の差。装飾なので WCAG 1.4.11 の 3:1 は求めないが、
 * 同じ色 (1.0) や、ほぼ同じ色では骨組みとして機能しない。
 */
const MIN_VISIBLE_CONTRAST = 1.1;

describe("Skeleton の見え方", () => {
  const fill = defaultFill();

  it.each([
    ["light", "background"],
    ["light", "card"],
    ["dark", "background"],
    ["dark", "card"],
  ] as const)("%s テーマの %s の上で見える", (theme, surface) => {
    const base = token(theme, surface);
    const painted = over(token(theme, fill.name), fill.alpha, base);
    expect(contrast(painted, base)).toBeGreaterThanOrEqual(MIN_VISIBLE_CONTRAST);
  });

  it("以前の bg-muted はライトのページ背景の上で見えなかった (この測り方で検出できる)", () => {
    const base = token("light", "background");
    expect(contrast(token("light", "muted"), base)).toBeLessThan(MIN_VISIBLE_CONTRAST);
  });
});
