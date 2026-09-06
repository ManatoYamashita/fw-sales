import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildCss } from "./support/build-css";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const AA_CONTRAST = 4.5;

type Rgb = readonly [number, number, number];
type Theme = "light" | "dark";

const RAW_PALETTE_CLASS =
  /\b(?:text|bg|border|ring|fill|stroke)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}(?:\/\d+)?\b|\b(?:text|bg|border)-(?:white|black)\b/g;

const CONTRAST_PAIRS: ReadonlyArray<{
  theme: Theme;
  foreground: string;
  background: string;
}> = [
  { theme: "light", foreground: "success-on-soft", background: "success-soft" },
  { theme: "dark", foreground: "success-on-soft", background: "success-soft" },
  { theme: "light", foreground: "success", background: "card" },
  { theme: "dark", foreground: "success", background: "card" },
  { theme: "light", foreground: "warning-on-soft", background: "warning-soft" },
  { theme: "dark", foreground: "warning-on-soft", background: "warning-soft" },
  {
    theme: "light",
    foreground: "destructive-on-soft",
    background: "destructive-soft",
  },
  {
    theme: "dark",
    foreground: "destructive-on-soft",
    background: "destructive-soft",
  },
  { theme: "light", foreground: "muted-foreground", background: "background" },
  { theme: "light", foreground: "muted-foreground", background: "muted" },
  { theme: "light", foreground: "muted-foreground", background: "card" },
  { theme: "dark", foreground: "muted-foreground", background: "background" },
  { theme: "dark", foreground: "muted-foreground", background: "muted" },
  { theme: "dark", foreground: "muted-foreground", background: "card" },
  { theme: "light", foreground: "link", background: "background" },
  { theme: "light", foreground: "link", background: "card" },
  { theme: "light", foreground: "link-hover", background: "card" },
  { theme: "dark", foreground: "link", background: "background" },
  { theme: "dark", foreground: "link", background: "card" },
  { theme: "dark", foreground: "link-hover", background: "card" },
];

function parseColor(value: string): Rgb {
  const hex = value.match(/^#([\da-f]{3}|[\da-f]{6})$/i)?.[1];
  if (hex) {
    const normalized = hex.length === 3
      ? hex.split("").map((digit) => `${digit}${digit}`).join("")
      : hex;
    return [0, 2, 4].map((offset) => parseInt(normalized.slice(offset, offset + 2), 16) / 255) as unknown as Rgb;
  }

  const oklch = value.match(
    /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*[\d.]+)?\s*\)$/,
  );
  if (!oklch) throw new Error(`未対応の色形式: ${value}`);

  const [, lightness, chroma, hue] = oklch;
  const angle = Number(hue) * Math.PI / 180;
  const a = Number(chroma) * Math.cos(angle);
  const b = Number(chroma) * Math.sin(angle);
  const l = Number(lightness) + 0.3963377774 * a + 0.2158037573 * b;
  const m = Number(lightness) - 0.1055613458 * a - 0.0638541728 * b;
  const s = Number(lightness) - 0.0894841775 * a - 1.291485548 * b;
  const l3 = l ** 3;
  const m3 = m ** 3;
  const s3 = s ** 3;
  return [
    4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
  ].map((channel) => Math.max(0, Math.min(1, channel))) as unknown as Rgb;
}

function relativeLuminance(rgb: Rgb): number {
  return rgb.reduce((sum, channel, index) => {
    const linear = channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
    return sum + linear * ([0.2126, 0.7152, 0.0722][index] ?? 0);
  }, 0);
}

export function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(parseColor(foreground));
  const backgroundLuminance = relativeLuminance(parseColor(background));
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
}

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === "__tests__") continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(target));
    else if (entry.isFile() && target.endsWith(".tsx")) files.push(target);
  }
  return files;
}

function themeBlock(css: string, theme: Theme): string {
  const selector = theme === "light" ? ":root" : "\\.dark";
  const block = css.match(new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1];
  if (!block) throw new Error(`${theme}テーマのトークンブロックがありません`);
  return block;
}

function tokenValue(css: string, theme: Theme, token: string): string {
  const value = themeBlock(css, theme).match(
    new RegExp(`^\\s*--${token}:\\s*([^;]+);`, "m"),
  )?.[1]?.trim();
  if (!value) throw new Error(`${theme}テーマの --${token} がありません`);
  return value;
}

describe("色トークンのコントラストガード (#249)", () => {
  it("実際のglobals.cssのlight/darkトークンがAA 4.5:1以上である", async () => {
    const css = await readFile(path.join(ROOT, "app/globals.css"), "utf8");
    for (const pair of CONTRAST_PAIRS) {
      const ratio = contrastRatio(
        tokenValue(css, pair.theme, pair.foreground),
        tokenValue(css, pair.theme, pair.background),
      );
      expect(
        ratio,
        `${pair.theme}: ${pair.foreground} on ${pair.background}`,
      ).toBeGreaterThanOrEqual(AA_CONTRAST);
    }
  });

  it("新しい色ユーティリティがTailwindの実CSSへ展開される", async () => {
    const candidates = [
      "text-success-on-soft",
      "text-warning-on-soft",
      "text-destructive-on-soft",
      "text-link",
      "text-link-hover",
      "text-confidence-foreground",
      "text-chart-1-foreground",
      "text-chart-5-foreground",
    ];
    const css = await buildCss(candidates);
    for (const candidate of candidates) {
      expect(css, `${candidate} が生成されていません`).toContain(`.${candidate}`);
    }
  });

  it("negative control: 是正前のmuted-foregroundは検出器で不合格になる", () => {
    expect(contrastRatio("#64748b", "#f1f5f9")).toBeLessThan(AA_CONTRAST);
  });

  it("画面実装へraw palette utilityを再流入させない", async () => {
    const files = [
      ...await sourceFiles(path.join(ROOT, "app")),
      ...await sourceFiles(path.join(ROOT, "components")),
    ];
    const violations: string[] = [];
    for (const file of files) {
      const content = await readFile(file, "utf8");
      for (const match of content.matchAll(RAW_PALETTE_CLASS)) {
        violations.push(`${path.relative(ROOT, file)}:${match[0]}`);
      }
    }
    expect(violations).toEqual([]);
  });
});
