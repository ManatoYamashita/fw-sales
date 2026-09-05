/**
 * UI プリミティブの基底クラスを利用側 `className` が上書きしようとしている箇所を落とす
 * (#250 Phase 3)。
 *
 * ## なぜ必要か
 *
 * `lib/utils/cn.ts` は素の `clsx` で `tailwind-merge` を持たない。同じ CSS プロパティを
 * 設定するクラスが 2 つ並ぶと**両方が出力され**、詳細度もレイヤも同じなので勝敗は
 * **生成 CSS の記述順**だけで決まる。書いた側の意図は一切関与しない。
 * #247 (`size="sm"` + `p-0`)、#248 (`Card.Body` の `p-0`)、#250 (10 群) と 3 回起きている。
 *
 * ## 走査の設計
 *
 * 基底クラスは**実装から直接取る**。`buttonVariants()` を呼び、他のプリミティブは
 * コンポーネント関数を呼んで返った React element の `className` を読む。
 * 列挙をテスト側へ写経すると、プリミティブに size や variant が増えた瞬間に検査が
 * 素通りする (`button-touch-target.test.ts` と同じ理由)。
 *
 * 突き合わせは**クラス名の一致ではなく CSS プロパティの一致**で行う。`gap-2` と
 * `gap-1.5`、`px-5` と `p-0` のように名前が違っても同じプロパティを争う組を拾うため。
 *
 * ## 既知の限界
 *
 * `padding={editing ? "default" : "flush"}` のように props が動的な場合は値を決められない。
 * その場合は**取りうる全値の基底クラスを合併**して検査する (検出漏れではなく過検出側へ倒す)。
 * `md:` などの variant 付きクラスは適用条件が別なので争わない。
 */

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BUTTON_GAP_CLASSES,
  BUTTON_SIZE_CLASSES,
  BUTTON_VARIANT_CLASSES,
  buttonVariants,
} from "../button";
import { CardBody } from "../card";
import { Select } from "../select";
import { Skeleton } from "../skeleton";
import { Spinner } from "../spinner";

type ComponentName = "Button" | "Card.Body" | "Select" | "Skeleton" | "Spinner";

type ClassConflict = {
  component: ComponentName;
  classes: string[];
};

const ROOT = path.resolve(import.meta.dirname, "../../..");

// ---------------------------------------------------------------------------
// CSS プロパティのモデル
// ---------------------------------------------------------------------------

const FONT_SIZES = new Set([
  "xs", "sm", "base", "lg", "xl",
  "2xl", "3xl", "4xl", "5xl", "6xl", "7xl", "8xl", "9xl",
]);
const TEXT_ALIGNS = new Set(["left", "center", "right", "justify", "start", "end"]);
/** `bg-*` のうち色ではないもの (repeat / position / size / attachment / clip)。 */
const BG_NON_COLOR =
  /^(no-repeat|repeat|repeat-x|repeat-y|repeat-round|repeat-space|cover|contain|auto|center|top|bottom|left|right|fixed|local|scroll|clip|origin|none|blend|gradient)/;
/** `border-*` のうち色ではないもの (幅 / スタイル)。 */
const BORDER_NON_COLOR =
  /^(\d+|solid|dashed|dotted|double|hidden|none|collapse|separate|spacing)$/;

const PADDING_EDGES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["px-", ["pl", "pr"]],
  ["py-", ["pt", "pb"]],
  ["pt-", ["pt"]],
  ["pr-", ["pr"]],
  ["pb-", ["pb"]],
  ["pl-", ["pl"]],
  ["ps-", ["pl"]],
  ["pe-", ["pr"]],
  ["p-", ["pt", "pr", "pb", "pl"]],
];

const ROUNDED_CORNERS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["rounded-tl", ["tl"]],
  ["rounded-tr", ["tr"]],
  ["rounded-br", ["br"]],
  ["rounded-bl", ["bl"]],
  ["rounded-t", ["tl", "tr"]],
  ["rounded-r", ["tr", "br"]],
  ["rounded-b", ["br", "bl"]],
  ["rounded-l", ["tl", "bl"]],
];

/** 単純な `prefix -> プロパティ` の対応。長い prefix から順に見る。 */
const SIMPLE_PREFIXES: ReadonlyArray<readonly [string, string]> = [
  ["min-h-", "min-height"],
  ["min-w-", "min-width"],
  ["max-h-", "max-height"],
  ["max-w-", "max-width"],
  ["gap-x-", "column-gap"],
  ["gap-y-", "row-gap"],
  ["h-", "height"],
  ["w-", "width"],
  ["shadow-", "box-shadow"],
  ["whitespace-", "white-space"],
  ["animate-", "animation"],
  ["opacity-", "opacity"],
];

const DISPLAY_TOKENS = new Set([
  "block", "inline-block", "inline", "flex", "inline-flex", "grid",
  "inline-grid", "contents", "hidden", "flow-root", "list-item",
]);

/**
 * そのクラスが設定する CSS プロパティ。同じ値を返す 2 つは記述順で争う。
 * 判定できないもの (任意値、variant 付き、色以外の複合ユーティリティ) は空を返す。
 */
export function cssProperties(token: string): string[] {
  // `md:` `hover:` `[&>option]:` などは適用条件が違うので基底とは争わない。
  if (token.includes(":")) return [];
  // `bg-[right_0.6rem_center]` `[background-size:12px]` のような任意値は解釈しない。
  if (token.includes("[")) return [];

  if (DISPLAY_TOKENS.has(token)) return ["display"];
  if (token === "shadow") return ["box-shadow"];
  if (token === "rounded") {
    return ["tl", "tr", "br", "bl"].map((c) => `border-radius-${c}`);
  }

  for (const [prefix, corners] of ROUNDED_CORNERS) {
    if (token === prefix || token.startsWith(`${prefix}-`)) {
      return corners.map((c) => `border-radius-${c}`);
    }
  }
  if (token.startsWith("rounded-")) {
    return ["tl", "tr", "br", "bl"].map((c) => `border-radius-${c}`);
  }

  for (const [prefix, edges] of PADDING_EDGES) {
    if (token.startsWith(prefix)) return edges.map((e) => `padding-${e}`);
  }

  if (token === "gap" || token.startsWith("gap-")) {
    const [, rest = ""] = /^gap-(.*)$/.exec(token) ?? [];
    if (!rest.startsWith("x-") && !rest.startsWith("y-")) {
      return ["column-gap", "row-gap"];
    }
  }

  for (const [prefix, property] of SIMPLE_PREFIXES) {
    if (token.startsWith(prefix)) return [property];
  }

  if (token.startsWith("text-")) {
    const value = token.slice("text-".length);
    if (FONT_SIZES.has(value)) return ["font-size"];
    if (TEXT_ALIGNS.has(value)) return ["text-align"];
    return ["color"];
  }
  if (token.startsWith("bg-")) {
    const value = token.slice("bg-".length);
    return BG_NON_COLOR.test(value) ? [] : ["background-color"];
  }
  if (token.startsWith("border-")) {
    const value = token.slice("border-".length);
    return BORDER_NON_COLOR.test(value) ? [] : ["border-color"];
  }

  return [];
}

// ---------------------------------------------------------------------------
// 実装から基底クラスを取る
// ---------------------------------------------------------------------------

/**
 * props の値が JSX で静的に読めなかったときに合併する候補。
 *
 * Button は実装の表をそのまま読むので、variant / size が増えても追従する。
 * 他のプリミティブは props の型が union リテラルなので、ここへ足すのは型と一対一。
 */
const PROP_VALUES: Record<string, readonly string[]> = {
  "Button.variant": Object.keys(BUTTON_VARIANT_CLASSES),
  "Button.size": Object.keys(BUTTON_SIZE_CLASSES),
  "Button.gap": Object.keys(BUTTON_GAP_CLASSES),
  "Select.width": ["full", "auto"],
  "Select.density": ["default", "compact"],
  "Card.Body.padding": ["default", "compact", "flush", "spacious"],
  "Skeleton.tone": ["muted", "card"],
  "Spinner.size": ["sm", "md", "lg"],
  "Spinner.tone": ["muted", "primary"],
};

function renderedClassName(element: unknown): string {
  const props = (element as { props?: { className?: string } } | null)?.props;
  return props?.className ?? "";
}

/** そのタグの props から、実装が実際に出す基底クラスを得る。 */
function baseClasses(
  tag: string,
  component: ComponentName,
  attributes: (name: string) => string | undefined,
): string[] {
  const pick = (name: string, key: string): readonly (string | undefined)[] => {
    const literal = attributes(name);
    if (literal !== undefined) return [literal];
    // `padding={...}` のように動的なら値を決められないので全候補を合併する。
    if (new RegExp(`\\b${name}\\s*=\\s*\\{`).test(tag)) {
      const candidates = PROP_VALUES[key];
      if (candidates === undefined) {
        throw new Error(`PROP_VALUES に ${key} がありません`);
      }
      return candidates;
    }
    return [undefined];
  };

  const collect = (values: string[][]): string[] => [
    ...new Set(values.flat()),
  ];

  switch (component) {
    case "Button": {
      const variants = pick("variant", "Button.variant");
      const sizes = pick("size", "Button.size");
      const gaps = pick("gap", "Button.gap");
      const out: string[][] = [];
      for (const variant of variants) {
        for (const size of sizes) {
          for (const gap of gaps) {
            out.push(
              buttonVariants({
                variant: variant as never,
                size: size as never,
                gap: gap as never,
              }).split(/\s+/),
            );
          }
        }
      }
      return collect(out);
    }
    case "Select": {
      const out: string[][] = [];
      for (const width of pick("width", "Select.width")) {
        for (const density of pick("density", "Select.density")) {
          out.push(
            renderedClassName(
              Select({ width: (width ?? "full") as never, density: density as never }),
            ).split(/\s+/),
          );
        }
      }
      return collect(out);
    }
    case "Card.Body": {
      return collect(
        pick("padding", "Card.Body.padding").map((padding) =>
          renderedClassName(CardBody({ padding: padding as never })).split(/\s+/),
        ),
      );
    }
    case "Skeleton": {
      return collect(
        pick("tone", "Skeleton.tone").map((tone) =>
          renderedClassName(Skeleton({ tone: tone as never })).split(/\s+/),
        ),
      );
    }
    case "Spinner": {
      const out: string[][] = [];
      for (const size of pick("size", "Spinner.size")) {
        for (const tone of pick("tone", "Spinner.tone")) {
          out.push(
            renderedClassName(
              Spinner({ size: size as never, tone: tone as never }),
            ).split(/\s+/),
          );
        }
      }
      return collect(out);
    }
  }
}

// ---------------------------------------------------------------------------
// JSX の走査
// ---------------------------------------------------------------------------

/** JSX の属性内にアロー関数があっても、`>` でタグを途中終了させない。 */
function openingTags(
  source: string,
  component: ComponentName,
): Array<{ text: string; index: number }> {
  const tags: Array<{ text: string; index: number }> = [];
  const marker = `<${component}`;
  let from = 0;

  while (true) {
    const index = source.indexOf(marker, from);
    if (index < 0) break;
    const boundary = source[index + marker.length];
    if (boundary && !/[\s/>]/.test(boundary)) {
      from = index + marker.length;
      continue;
    }

    let quote: '"' | "'" | "`" | null = null;
    let braces = 0;
    let end = index + marker.length;
    for (; end < source.length; end += 1) {
      const char = source[end];
      if (quote) {
        if (char === quote && source[end - 1] !== "\\") quote = null;
        continue;
      }
      if (char === '"' || char === "'" || char === "`") {
        quote = char;
      } else if (char === "{") {
        braces += 1;
      } else if (char === "}") {
        braces = Math.max(0, braces - 1);
      } else if (char === ">" && braces === 0) {
        tags.push({ text: source.slice(index, end + 1), index });
        break;
      }
    }
    from = Math.max(end + 1, index + marker.length);
  }
  return tags;
}

function attribute(tag: string, name: string): string | undefined {
  return new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`).exec(tag)?.[1];
}

function classes(tag: string): string[] {
  return (attribute(tag, "className") ?? "").split(/\s+/).filter(Boolean);
}

export function findClassConflicts(
  tag: string,
  component: ComponentName,
): ClassConflict | null {
  const base = baseClasses(tag, component, (name) => attribute(tag, name));
  const baseProperties = new Set(base.flatMap(cssProperties));
  const baseTokens = new Set(base);

  const conflicting = classes(tag).filter((token) => {
    // 同一トークンの重複は勝敗が発生しないので無害。
    if (baseTokens.has(token)) return false;
    return cssProperties(token).some((property) => baseProperties.has(property));
  });

  return conflicting.length > 0 ? { component, classes: conflicting } : null;
}

async function collectTsxFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectTsxFiles(fullPath)));
    } else if (entry.isFile() && fullPath.endsWith(".tsx")) {
      files.push(fullPath);
    }
  }
  return files;
}

const COMPONENTS: ComponentName[] = [
  "Button",
  "Card.Body",
  "Select",
  "Skeleton",
  "Spinner",
];

async function scanRepository(): Promise<string[]> {
  const files = [
    ...(await collectTsxFiles(path.join(ROOT, "app"))),
    ...(await collectTsxFiles(path.join(ROOT, "components"))),
  ];
  const findings: string[] = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const component of COMPONENTS) {
      for (const tag of openingTags(source, component)) {
        const conflict = findClassConflicts(tag.text, component);
        if (conflict) {
          const line = source.slice(0, tag.index).split("\n").length;
          findings.push(
            `${path.relative(ROOT, file)}:${line} <${component}> ${conflict.classes.join(", ")}`,
          );
        }
      }
    }
  }
  return findings;
}

describe("UI primitive class conflict guard", () => {
  it("走査対象の JSX が空振りしていない", async () => {
    const files = [
      ...(await collectTsxFiles(path.join(ROOT, "app"))),
      ...(await collectTsxFiles(path.join(ROOT, "components"))),
    ];
    expect(files.length).toBeGreaterThan(50);
  });

  it("リポジトリ内の基底クラスを className で上書きしない", async () => {
    expect(await scanRepository()).toEqual([]);
  });

  it("負け側のクラスを negative control で検知する", () => {
    // #250 group 1: Select の色。
    expect(
      findClassConflicts(
        '<Select width="full" className="w-auto text-muted-foreground/70" />',
        "Select",
      ),
    ).toEqual({
      component: "Select",
      classes: ["w-auto", "text-muted-foreground/70"],
    });
    // #250 group 4: インラインスピナーの寸法。
    expect(
      findClassConflicts('<Spinner className="h-3 w-3" />', "Spinner"),
    ).toEqual({ component: "Spinner", classes: ["h-3", "w-3"] });
    // #248: `p-0` は `px-5 py-4` の両方に負ける。
    expect(
      findClassConflicts('<Card.Body className="p-0" />', "Card.Body"),
    ).toEqual({ component: "Card.Body", classes: ["p-0"] });
    // #250 group 10: スケルトンの背景。
    expect(
      findClassConflicts('<Skeleton className="bg-card" />', "Skeleton"),
    ).toEqual({ component: "Skeleton", classes: ["bg-card"] });
    // #250 group 9: Button の size 指定。
    expect(
      findClassConflicts(
        '<Button size="sm" className="h-7 px-2 text-xs" />',
        "Button",
      ),
    ).toEqual({ component: "Button", classes: ["h-7", "px-2", "text-xs"] });
    // 名前が違っても同じプロパティなら拾う (旧実装が取りこぼしていた面)。
    expect(
      findClassConflicts('<Button className="gap-1.5" />', "Button"),
    ).toEqual({ component: "Button", classes: ["gap-1.5"] });
    expect(
      findClassConflicts('<Button size="icon" className="w-full" />', "Button"),
    ).toEqual({ component: "Button", classes: ["w-full"] });
    // `width="auto"` は `w-` を出さないので幅指定だけが免除される。高さと色は争う。
    expect(
      findClassConflicts('<Select width="auto" className="w-32" />', "Select"),
    ).toBeNull();
    expect(
      findClassConflicts(
        '<Select width="auto" className="h-11 text-destructive" />',
        "Select",
      ),
    ).toEqual({ component: "Select", classes: ["h-11", "text-destructive"] });
  });

  it("variant 付きクラスと同一トークンは衝突扱いしない", () => {
    // `md:` は適用条件が違うので基底と争わない。
    expect(
      findClassConflicts('<Button className="md:w-auto" />', "Button"),
    ).toBeNull();
    // 同じ値を書き直しただけなら勝敗が発生しない。
    expect(
      findClassConflicts('<Card.Body className="py-4" />', "Card.Body"),
    ).toBeNull();
  });
});

/**
 * プリミティブが**自分自身の基底クラスの中で**同じ CSS プロパティを二重に設定していないか。
 *
 * 利用側の `className` を見るだけでは足りない。`Button` の基底に `gap-2` を残したまま
 * `gap` 軸へ `gap-1.5` を足す、`Select` の基底に `text-sm` を残したまま `density="compact"`
 * へ `text-xs` を足す、といった形だと**プリミティブの内部で記述順勝負になる**。
 * どちらも実際に起きた (#250 レビュー)。
 */
const SELF_CONFLICT_CASES: Array<{ name: string; classes: () => string[] }> = [
  ...Object.keys(BUTTON_VARIANT_CLASSES).flatMap((variant) =>
    Object.keys(BUTTON_SIZE_CLASSES).flatMap((size) =>
      Object.keys(BUTTON_GAP_CLASSES).map((gap) => ({
        name: `Button variant=${variant} size=${size} gap=${gap}`,
        classes: () =>
          buttonVariants({
            variant: variant as never,
            size: size as never,
            gap: gap as never,
          }).split(/\s+/),
      })),
    ),
  ),
  ...(["full", "auto"] as const).flatMap((width) =>
    (["default", "compact"] as const).map((density) => ({
      name: `Select width=${width} density=${density}`,
      classes: () =>
        renderedClassName(Select({ width, density })).split(/\s+/),
    })),
  ),
  ...(["default", "compact", "flush", "spacious"] as const).map((padding) => ({
    name: `Card.Body padding=${padding}`,
    classes: () => renderedClassName(CardBody({ padding })).split(/\s+/),
  })),
  ...(["muted", "card"] as const).map((tone) => ({
    name: `Skeleton tone=${tone}`,
    classes: () => renderedClassName(Skeleton({ tone })).split(/\s+/),
  })),
  ...(["sm", "md", "lg"] as const).flatMap((size) =>
    (["muted", "primary"] as const).map((tone) => ({
      name: `Spinner size=${size} tone=${tone}`,
      classes: () => renderedClassName(Spinner({ size, tone })).split(/\s+/),
    })),
  ),
];

/**
 * `variant: link` は `px-0 h-auto` で size の寸法を打ち消す作りだが、`px-0` は
 * どの size の `px-*` にも負ける (実測: `.px-0` 5089 < `.px-4` 5149)。`h-auto` は
 * 逆に全数値高さより後に出るので効く。**現状 `variant="link"` の呼び出しは 0 件**
 * なので実害は無いが、使い始めるなら先に size を打ち消す方法ごと設計し直すこと。
 * ここで除外しているのはこの既知の 1 組だけで、新しい自己衝突は落ちる。
 */
const KNOWN_SELF_CONFLICTS = new Set(
  Object.keys(BUTTON_SIZE_CLASSES).flatMap((size) =>
    Object.keys(BUTTON_GAP_CLASSES).map(
      (gap) => `Button variant=link size=${size} gap=${gap}`,
    ),
  ),
);

/**
 * ショートハンドの段階。`px-3 pr-8` のように**より具体的な側が後から上書きする**書き方は
 * Tailwind が「一括 → 軸 → 辺」の順で出力するので順序が保証されており、事故ではない。
 * 自己衝突として数えるのは**同じ段階どうし**が同じ辺を争う場合だけ。
 *
 * 利用側 `className` との突き合わせ (`findClassConflicts`) ではこの段階を見ない。
 * 呼び出し側は基底より後に書いても勝てない (#248 の `Card.Body` + `p-0` がその実例) ため、
 * 段階が違っても「上書きできない」ことに変わりがないからである。
 */
function specificity(token: string): number {
  if (/^p[trblse]-/.test(token)) return 2;
  if (/^p[xy]-/.test(token)) return 1;
  if (/^p-/.test(token)) return 0;
  if (/^rounded-(tl|tr|br|bl)(-|$)/.test(token)) return 2;
  if (/^rounded-(t|r|b|l)(-|$)/.test(token)) return 1;
  return 0;
}

/** 同じプロパティを同じ段階で 2 回以上設定しているトークンの組。 */
function selfConflicts(classes: string[]): string[] {
  const byProperty = new Map<string, { property: string; tokens: string[] }>();
  for (const token of classes) {
    for (const property of cssProperties(token)) {
      const key = `${property}@${specificity(token)}`;
      const entry = byProperty.get(key) ?? { property, tokens: [] };
      entry.tokens = [...new Set([...entry.tokens, token])];
      byProperty.set(key, entry);
    }
  }
  return [...byProperty.values()]
    .filter(({ tokens }) => tokens.length > 1)
    .map(({ property, tokens }) => `${property}: ${tokens.join(" vs ")}`);
}

describe("プリミティブ自身の基底クラスが自己衝突しない", () => {
  it("検査対象の組み合わせが空でない", () => {
    expect(SELF_CONFLICT_CASES.length).toBeGreaterThan(0);
  });

  it.each(SELF_CONFLICT_CASES.filter((c) => !KNOWN_SELF_CONFLICTS.has(c.name)))(
    "$name",
    ({ classes }) => {
      expect(selfConflicts(classes())).toEqual([]);
    },
  );

  it("既知の自己衝突は検知できている (除外が空振りしていないことの確認)", () => {
    const link = SELF_CONFLICT_CASES.find(
      (c) => c.name === "Button variant=link size=md gap=default",
    );
    expect(link).toBeDefined();
    expect(selfConflicts(link!.classes())).toContain(
      "padding-pl: px-0 vs px-4",
    );
  });
});
