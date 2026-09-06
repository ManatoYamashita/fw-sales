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
 * ## className の読み取り
 *
 * 利用側の `className` は**リテラルでも式でも読む** (`support/jsx-class-scan.ts`)。
 * 当初は `className="..."` の二重引用符しか読まず、`className={...}` はタグごと無検査で
 * 通過していた。#248 の原文 (`className={editing ? undefined : "p-0"}`) がその形で、
 * ガードは事故の実物を 1 件も落とせていなかった (#262)。
 *
 * 式は取り出せた文字列リテラルを合併して検査し、**クラスを供給しうるのに読めない部分**
 * (変数参照など) があれば fail-closed で落とす。無検査で通すと、次に誰かがその形で
 * 書いた瞬間に無言で穴が開く。
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
  buttonClasses,
} from "../button";
import { CardBody, CardFooter, CardHeader } from "../card";
import { Select } from "../select";
import { Skeleton } from "../skeleton";
import { Spinner } from "../spinner";
import {
  openingTags,
  readClassAttribute,
  readStringAttribute,
} from "./support/jsx-class-scan";
import { buildCss } from "./support/build-css";
import { hidden } from "./support/scanner-hidden";

type ComponentName =
  | "Button"
  | "Card.Body"
  | "Card.Header"
  | "Card.Footer"
  | "Select"
  | "Skeleton"
  | "Spinner";

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
/**
 * **リポジトリが使っていないクラスは、走査へ拾わせないため実行時に組み立てる (#265)。**
 *
 * このファイルは模型の対応表と negative control の needle として、本番 JSX に 1 度も
 * 出てこないクラス名を大量に持つ。逐語で書くと Tailwind の静的走査が候補として拾い、
 * **使っていないクラスの規則が本番 CSS に生まれる**。実測で 16 語 997 バイトあった
 * (`support/scanner-hidden.ts` / `docs/architecture/responsive.md` §4.2)。
 *
 * 分割位置は「どの断片も単独ではクラスとして解決しないこと」で選んでいる。
 * 全断片が 0 バイトであることを実測で確認済み。
 */
const ROUNDED = {
  tl: hidden("round", "ed-tl"),
  tr: hidden("round", "ed-tr"),
  br: hidden("round", "ed-br"),
  bl: hidden("round", "ed-bl"),
  t: hidden("round", "ed-t"),
  r: hidden("round", "ed-r"),
  b: hidden("round", "ed-b"),
  l: hidden("round", "ed-l"),
} as const;

/** negative control とモデル検査で使う、本番に無いクラス。 */
const NEEDLE = {
  nowrap: hidden("flex-", "nowrap"),
  justifyStart: hidden("justify-", "start"),
  contentCenter: hidden("content-", "center"),
  widthAuto: hidden("w-", "auto"),
  /** 模型が名指しで見るクラス。単独 +284 バイトと、この群で最も高い。 */
  shadow: hidden("sha", "dow"),
  inline: hidden("inl", "ine"),
  /** `border-collapse` の値。正規表現の中でも走査は拾う。 */
  collapse: hidden("colla", "pse"),
} as const;

const BG_NON_COLOR =
  /^(no-repeat|repeat|repeat-x|repeat-y|repeat-round|repeat-space|cover|contain|auto|center|top|bottom|left|right|fixed|local|scroll|clip|origin|none|blend|gradient)/;
/**
 * `border-*` のうち色ではないもの (幅 / スタイル)。
 *
 * 値を配列へ出しているのは、`border-collapse` の値のひとつが**単独で Tailwind の
 * クラスとして解決し、正規表現リテラルの中に書いても走査が拾ってしまう**ため (#265)。
 * `NEEDLE` 経由で実行時に組み立てる。クラス名を逐語で書くとこの対処が無意味になる。
 */
const BORDER_NON_COLOR_VALUES = [
  "solid", "dashed", "dotted", "double", "hidden", "none",
  NEEDLE.collapse, "separate", "spacing",
];
const BORDER_NON_COLOR = new RegExp(
  `^(\\d+|${BORDER_NON_COLOR_VALUES.join("|")})$`,
);

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
  [ROUNDED.tl, ["tl"]],
  [ROUNDED.tr, ["tr"]],
  [ROUNDED.br, ["br"]],
  [ROUNDED.bl, ["bl"]],
  [ROUNDED.t, ["tl", "tr"]],
  [ROUNDED.r, ["tr", "br"]],
  [ROUNDED.b, ["br", "bl"]],
  [ROUNDED.l, ["tl", "bl"]],
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
  "block", "inline-block", NEEDLE.inline, "flex", "inline-flex", "grid", "contents", "hidden",
  // 本番に出てこない 3 語は走査へ拾わせない (上の ROUNDED と同じ理由)。
  hidden("inline-g", "rid"), hidden("flow-r", "oot"), hidden("list-i", "tem"),
]);

/**
 * flex コンテナの並べ方を決めるトークン (#270)。
 *
 * `Card.Header` / `Card.Footer` の契約はここに集中している (`flex-wrap` で折り返し、
 * `justify-*` で寄せ、`items-*` で交差軸)。モデル化しないと、利用側が
 * `flex-wrap: nowrap` 側の値を渡しても衝突として検出されず、**折り返しが無言で
 * 消える**。`flex-1` などの flex **アイテム**側の指定は別プロパティなので混ぜない。
 * (クラス名を逐語で書かないのは、この散文も走査対象だから。`NEEDLE` を参照。)
 */
const FLEX_CONTAINER_TOKENS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^flex-(wrap|nowrap|wrap-reverse)$/, "flex-wrap"],
  [/^flex-(row|row-reverse|col|col-reverse)$/, "flex-direction"],
  [/^justify-/, "justify-content"],
  [/^items-/, "align-items"],
  [/^content-/, "align-content"],
];

/**
 * そのクラスが設定する CSS プロパティ。同じ値を返す 2 つは記述順で争う。
 * 判定できないもの (任意値、variant 付き、色以外の複合ユーティリティ) は空を返す。
 */
export function cssProperties(token: string): string[] {
  // `md:` `hover:` `[&>option]:` などは適用条件が違うので基底とは争わない。
  if (token.includes(":")) return [];
  // 角括弧を含む任意値は解釈しない (例は §4.2 の規則により散文へ書かない)。
  if (token.includes("[")) return [];

  if (DISPLAY_TOKENS.has(token)) return ["display"];
  for (const [pattern, property] of FLEX_CONTAINER_TOKENS) {
    if (pattern.test(token)) return [property];
  }
  if (token === NEEDLE.shadow) return ["box-shadow"];
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
              // `buttonVariants()` ではなく component と同じ resolver を通す。
              // 直接呼ぶと boxless variant の除外が抜けた別物を検査してしまう。
              buttonClasses({
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
    case "Card.Header": {
      return renderedClassName(CardHeader({})).split(/\s+/);
    }
    case "Card.Footer": {
      return renderedClassName(CardFooter({})).split(/\s+/);
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

export function findClassConflicts(
  tag: string,
  component: ComponentName,
): ClassConflict | null {
  const base = baseClasses(tag, component, (name) => readStringAttribute(tag, name));
  const baseProperties = new Set(base.flatMap(cssProperties));
  const baseTokens = new Set(base);

  const conflicting = readClassAttribute(tag).tokens.filter((token) => {
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
  "Card.Header",
  "Card.Footer",
  "Select",
  "Skeleton",
  "Spinner",
];

type Scan = {
  /** 基底クラスと同じ CSS プロパティを利用側が上書きしている箇所。 */
  conflicts: string[];
  /** `className` が式で、クラスを供給しうる読めない部分を含むタグ。 */
  unreadable: string[];
  /** 走査した `className` の書き方の内訳。空振り検出に使う。 */
  forms: Record<"literal" | "expression", number>;
};

async function scanRepository(): Promise<Scan> {
  const files = [
    ...(await collectTsxFiles(path.join(ROOT, "app"))),
    ...(await collectTsxFiles(path.join(ROOT, "components"))),
  ];
  const scan: Scan = {
    conflicts: [],
    unreadable: [],
    forms: { literal: 0, expression: 0 },
  };
  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const component of COMPONENTS) {
      for (const tag of openingTags(source, component)) {
        const where = () =>
          `${path.relative(ROOT, file)}:${source.slice(0, tag.index).split("\n").length}`;

        const attribute = readClassAttribute(tag.text);
        if (attribute.form !== "absent") scan.forms[attribute.form] += 1;
        // 読めない式を無検査で通さない (#262)。通すと、次に誰かがその形で
        // 書いた瞬間に無言で穴が開き、緑のまま事故が入る。
        if (attribute.unreadable) {
          scan.unreadable.push(`${where()} <${component}>`);
        }

        const conflict = findClassConflicts(tag.text, component);
        if (conflict) {
          scan.conflicts.push(
            `${where()} <${component}> ${conflict.classes.join(", ")}`,
          );
        }
      }
    }
  }
  return scan;
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
    expect((await scanRepository()).conflicts).toEqual([]);
  });

  it("className を式で書いていて中身を読めないタグが無い", async () => {
    // fail-closed (#262)。読めない式を素通りさせると、そのタグは検査されていないのに
    // 緑になる。導入時点の実測は 77 件すべてリテラルで、この検査の初期コストは 0 だった。
    // 落ちた場合は「クラスを文字列リテラルで書く」か、props へ意図を移す。
    expect((await scanRepository()).unreadable).toEqual([]);
  });

  it("className の走査が空振りしていない", async () => {
    // 読み取りが壊れると衝突も出ないので、緑だけでは検知力を保証できない。
    // 実際に className を読めている件数を下限で固定する。
    expect((await scanRepository()).forms.literal).toBeGreaterThan(50);
  });

  it("負け側のクラスを negative control で検知する", () => {
    // #250 group 1: Select の色。
    expect(
      findClassConflicts(
        `<Select width="full" className="${NEEDLE.widthAuto} text-muted-foreground/70" />`,
        "Select",
      ),
    ).toEqual({
      component: "Select",
      classes: [NEEDLE.widthAuto, "text-muted-foreground/70"],
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
    // #270 の flex コンテナ軸。この 3 例が無いと `FLEX_CONTAINER_TOKENS` を丸ごと
    // 削除しても 141 files / 3840 tests が緑のままで、模型が消えたことに CI が
    // 気づけなかった (PR #271 のレビューで実測)。利用側が上書きすると折り返しが
    // 無言で消え、症状は #270 と同じ「操作が押せない」に戻る。
    expect(
      findClassConflicts(`<Card.Header className="${NEEDLE.nowrap}" />`, "Card.Header"),
    ).toEqual({ component: "Card.Header", classes: [NEEDLE.nowrap] });
    expect(
      findClassConflicts('<Card.Header className="items-start" />', "Card.Header"),
    ).toEqual({ component: "Card.Header", classes: ["items-start"] });
    expect(
      findClassConflicts(`<Card.Footer className="${NEEDLE.justifyStart}" />`, "Card.Footer"),
    ).toEqual({ component: "Card.Footer", classes: [NEEDLE.justifyStart] });
    // 基底が争わない軸は緑に転じる (弁別性)。「何を書いても落ちる」ではない。
    expect(
      findClassConflicts('<Card.Header className="rounded-md" />', "Card.Header"),
    ).toBeNull();
  });

  it("flex コンテナ軸をプロパティへ写像する (#270)", () => {
    // 上の negative control は**基底が実際に持つ軸**しか通せない。`flex-direction` と
    // `align-content` はどのプリミティブの基底にも無いため経路が無く、模型から
    // その 2 行を消しても衝突は 1 件も増減しない。だから模型を直接測る。
    expect(cssProperties("flex-wrap")).toEqual(["flex-wrap"]);
    expect(cssProperties(NEEDLE.nowrap)).toEqual(["flex-wrap"]);
    expect(cssProperties("flex-col")).toEqual(["flex-direction"]);
    expect(cssProperties("justify-between")).toEqual(["justify-content"]);
    expect(cssProperties("items-center")).toEqual(["align-items"]);
    expect(cssProperties(NEEDLE.contentCenter)).toEqual(["align-content"]);
    // 境界。`flex` は display、`flex-1` は flex **アイテム**側の指定なので、
    // ここへ吸わせると `<Button className="flex-1">` のような正当な指定を誤検出する。
    expect(cssProperties("flex")).toEqual(["display"]);
    expect(cssProperties("flex-1")).toEqual([]);
  });

  it("事故の原文 (式で書いた className) を negative control で検知する", () => {
    // ここが #262 の中身。**書き方を静的リテラルへ直した negative control は全部
    // 通っていた**一方で、実際に事故った行の原文はこの形で、1 件も落ちなかった。
    // `docs/architecture/responsive.md` §5「壊し方は実際に事故った行の原文を使う」。

    // #248 map-embed-card.tsx:104 の原文。
    expect(
      findClassConflicts(
        '<Card.Body className={editing ? undefined : "p-0"}>',
        "Card.Body",
      ),
    ).toEqual({ component: "Card.Body", classes: ["p-0"] });
    // #248 web-asset-card.tsx:115 の原文。
    expect(
      findClassConflicts(
        '<Card.Body className={editing ? undefined : "py-1"}>',
        "Card.Body",
      ),
    ).toEqual({ component: "Card.Body", classes: ["py-1"] });

    // 是正後の形は緑に転じる (弁別性)。
    expect(
      findClassConflicts(
        '<Card.Body padding={editing ? "default" : "flush"}>',
        "Card.Body",
      ),
    ).toBeNull();
    expect(
      findClassConflicts(
        '<Card.Body padding={editing ? "default" : "compact"}>',
        "Card.Body",
      ),
    ).toBeNull();

    // 三項の両側を合併するので、どちらの枝で衝突しても落ちる。
    expect(
      findClassConflicts('<Spinner className={busy ? "h-3 w-3" : undefined} />', "Spinner"),
    ).toEqual({ component: "Spinner", classes: ["h-3", "w-3"] });
    // `cn(...)` の引数と `&&` の右辺も読む。
    expect(
      findClassConflicts('<Button className={cn("ml-auto", busy && "gap-1.5")} />', "Button"),
    ).toEqual({ component: "Button", classes: ["gap-1.5"] });
    // 単一引用符の props も読む (二重引用符しか読まない実装では size 既定と誤認した)。
    expect(
      findClassConflicts(`<Button size='sm' className="h-7" />`, "Button"),
    ).toEqual({ component: "Button", classes: ["h-7"] });
  });

  it("走査から隠したクラス名が実在する (#265)", async () => {
    // `hidden()` は**実行時連結**なので、断片を打ち間違えても型もリンタも気づかない。
    // 模型が「存在しないクラス名」を見張り続けても全テストが緑のまま通る
    // (実測: `ROUNDED.tl` の断片を壊しても 266 件すべて green だった)。
    //
    // 実在の判定は**Tailwind 自身**に任せる。`cssProperties()` で往復させると、
    // 壊れた名前が模型の表にも入っているため**循環して必ず通る**ので使えない。
    const empty = Buffer.byteLength(await buildCss([]));
    for (const token of [...Object.values(ROUNDED), ...Object.values(NEEDLE)]) {
      const size = Buffer.byteLength(await buildCss([token]));
      expect(size, `隠したクラス名が CSS を生まない: ${token}`).toBeGreaterThan(empty);
    }
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
          buttonClasses({
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

  it.each(SELF_CONFLICT_CASES)("$name", ({ classes }) => {
    expect(selfConflicts(classes())).toEqual([]);
  });

  it("同じ段階の重複を検知し、段階違いは見逃さない (negative control)", () => {
    // 実際に起きた 2 件。基底へ `gap-2` を残したまま `gap` 軸を足した形と、
    // 基底へ `text-sm` を残したまま compact へ `text-xs` を足した形。
    expect(selfConflicts(["gap-2", "gap-1.5"])).toEqual([
      "column-gap: gap-2 vs gap-1.5",
      "row-gap: gap-2 vs gap-1.5",
    ]);
    expect(selfConflicts(["text-sm", "text-xs"])).toEqual([
      "font-size: text-sm vs text-xs",
    ]);
    // `variant: link` が持っていた形。size を非適用にしたので実装からは消えた。
    expect(selfConflicts(["px-0", "px-4"])).toEqual([
      "padding-pl: px-0 vs px-4",
      "padding-pr: px-0 vs px-4",
    ]);
    // 段階が違う組は意図的なカスケードなので数えない。
    expect(selfConflicts(["px-3", "pr-8"])).toEqual([]);
    expect(selfConflicts(["p-0", "px-5", "py-4"])).toEqual([]);
  });
});
