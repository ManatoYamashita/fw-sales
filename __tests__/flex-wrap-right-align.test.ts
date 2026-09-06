/**
 * `flex-wrap` と `justify-between` を同じ要素へ書いたら `[&>*+*]:ml-auto` を添える (#270)。
 *
 * ## 何が壊れるか
 *
 * **`justify-content` は行ごとに効く。** `justify-between` の行へ `flex-wrap` を足すと、
 * 操作だけが 2 行目へ落ちたとき**その行には要素が 1 つしかない**ので、`space-between` は
 * `flex-start` と同義になり**左寄せ**になる。1 行に収まっているうちは正しく右端にいるため、
 * 広い画面で見ている限り気づけない。
 *
 * 2 番目以降の子へ `margin-left: auto` を与えると、auto マージンが行の余白を吸うので
 * 折り返した行でも右寄せが保たれる。**子が 1 つのときは `* + *` に当たらないので何も
 * 起きず、折り返していないときは `justify-between` と同じ配置になる** (auto マージンが
 * 余白を等分するため)。つまり**足しても既存の見た目を 1px も変えない**。
 *
 * ## 実測 (実 CSS を headless Chrome で描画し 1px 刻みに掃引)
 *
 * | 箇所 | 操作が左端へ落ちる幅 | 帯域数 |
 * |---|---|---|
 * | `handoff-form` の `Card.Body` | Card 幅 260-546px | 287 |
 * | `/stores` ヘッダの「店舗を登録」 | viewport 320-488px | 169 |
 * | `(legal)` フッタのナビ | viewport 320-553px | 234 |
 *
 * いずれも 375 / 390 / 430px を含む。折り返さない幅では是正前後の位置差は 0px だった。
 * `handoff-form` の閾値 546px は `lg` 2 カラムの 478px より上で、狭幅だけの問題ではない。
 *
 * ## なぜこの形なら走査できるのか
 *
 * #270 では「`Card.Header` ブロックを切り出して `ml-auto` があるか見る」ガードを書いて
 * 撤去した。`{editing ? <保存群/> : <編集/>}` のような分岐を持つブロックでは
 * **1 つでもあれば通る**ため、片方の枝が欠けても素通りしたからである
 * (`docs/architecture/responsive.md` §4.5)。
 *
 * こちらは**単一の要素の class 列**で完結する。検査単位が 1 つの `className` 属性なので、
 * 分岐を読み落とす失敗モードが存在しない。式で分割して書かれても
 * `readClassAttribute` が取り出せるリテラルを合併するので拾える。
 *
 * ## 対象を `justify-between` に限る理由
 *
 * 折り返した行に要素が 1 つ残ったときの挙動は `justify-content` の値で変わる。
 * `flex-end` は右、`center` / `space-around` / `space-evenly` は中央になり、
 * どれも「左端へ飛ぶ」事故にはならない。左端に落ちるのは `space-between` だけ。
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readClassAttribute } from "@/components/ui/__tests__/support/jsx-class-scan";
import { buildCss } from "@/components/ui/__tests__/support/build-css";
import { hidden } from "@/components/ui/__tests__/support/scanner-hidden";

const ROOT = process.cwd();

/** 走査から外すディレクトリ。`.claude` は他ブランチのファイルツリーが展開されうる。 */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".claude",
  ".vercel",
  // 本番 JSX が検査対象。テストは検査文字列を本文に持つので自己ヒットする。
  "__tests__",
]);

const SCAN_ROOTS = ["app", "components", "lib"];

const WRAP = "flex-wrap";
const BETWEEN = "justify-between";
const REMEDY = "[&>*+*]:ml-auto";

/**
 * 前方一致の誤爆を確かめる needle。**本番 JSX に 1 度も出てこないので、逐語で書くと
 * Tailwind の走査が拾って使っていない規則が本番 CSS に生まれる** (#265)。
 * 実行時に連結して外す (`support/scanner-hidden.ts`)。断片はどちらも単独では
 * クラスとして解決しない (実測で 0 バイトを確認済み)。
 *
 * **実行時連結なので、断片を打ち間違えても型もリンタも気づかない。** 壊れた値は
 * `WRAP` と前方一致しなくなるだけなので `violatesTag` は素通りし、下の
 * negative control が無言で空回りする。それを下のテストが固定する (#276)。
 */
const WRAP_REVERSE = hidden("flex-", "wrap-reverse");

function collectFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(path.join(dir, entry.name));
      } else if (entry.isFile() && entry.name.endsWith(".tsx")) {
        found.push(path.join(dir, entry.name));
      }
    }
  };
  for (const root of SCAN_ROOTS) walk(root);
  return found;
}

/**
 * `n/a` 規則の対象外 / `satisfied` 対象で手当てあり /
 * `violation` 対象で手当てが無い / `unprovable` 対象だが読めない部分があり断定できない。
 *
 * ## `unprovable` を「両方を持つ場合」だけに絞る理由
 *
 * `cn(base, className)` で利用側のクラスを受け渡すプリミティブは、構造上つねに
 * 「読めない部分」を持つ。ここで「片方だけ持つ + 読めない」まで拾うと、
 * `Card.Footer` (基底は `flex-wrap` + `justify-end`) のような**規則を満たしている
 * プリミティブが毎回引っかかる**。
 *
 * その方向のリスク (利用側が `justify-between` や `flex-wrap: nowrap` 側の値を後から
 * 渡して基底の意図を壊す) は `components/ui/__tests__/class-conflicts.test.ts` が
 * `flex-wrap` / `justify-content` / `align-items` を模型に持って別途落とす。
 * 2 つのガードは合成して効く。
 */
export type Verdict = "n/a" | "satisfied" | "violation" | "unprovable";

export function classify(tokens: string[], unreadable: boolean): Verdict {
  const hasWrap = tokens.includes(WRAP);
  const hasBetween = tokens.includes(BETWEEN);
  const hasRemedy = tokens.includes(REMEDY);

  if (!hasWrap || !hasBetween) return "n/a";
  if (hasRemedy) return "satisfied";
  // 読めない部分が手当てを供給しうるなら違反と断定しない。断定しない代わりに
  // 素通りもさせず、`unprovable` として別に落とす。
  return unreadable ? "unprovable" : "violation";
}

/** 開始タグ 1 つ分の判定。negative control をタグの原文で書けるようにする。 */
export function violatesTag(tag: string): boolean {
  const read = readClassAttribute(tag);
  return classify(read.tokens, read.unreadable) === "violation";
}

type Finding = { where: string; verdict: Verdict };

function scan(): { candidates: Finding[]; violations: Finding[]; unprovable: Finding[]; attributes: number } {
  const candidates: Finding[] = [];
  const violations: Finding[] = [];
  const unprovable: Finding[] = [];
  let attributes = 0;

  for (const file of collectFiles()) {
    const source = readFileSync(path.join(ROOT, file), "utf8");
    for (const match of source.matchAll(/\bclassName\s*=/g)) {
      const read = readClassAttribute(source.slice(match.index));
      if (read.form === "absent") continue;
      attributes += 1;

      const verdict = classify(read.tokens, read.unreadable);
      if (verdict === "n/a") continue;

      const where = `${file}:${source.slice(0, match.index).split("\n").length}`;
      const finding: Finding = { where, verdict };
      candidates.push(finding);
      if (verdict === "violation") violations.push(finding);
      if (verdict === "unprovable") unprovable.push(finding);
    }
  }
  return { candidates, violations, unprovable, attributes };
}

describe("flex-wrap + justify-between は折り返した行の右寄せを持つ", () => {
  it("走査が空振りしていない", () => {
    // 読み取りが壊れると違反も出ないので、緑だけでは検知力を保証できない。
    // 導入時点の実測: 152 ファイル / className 1149 件 (リテラル 1114 + 式 35、
    // うち読めない部分を持つもの 29) / 規則の対象 7 件。
    const { attributes, candidates } = scan();
    expect(collectFiles().length).toBeGreaterThan(50);
    expect(attributes).toBeGreaterThan(500);
    // 0 件になったら走査が壊れたか規則が不要になったかのどちらかで、
    // どちらも黙って通してよい状態ではない。
    expect(candidates.length).toBeGreaterThan(3);
  });

  it("対象すべてに [&>*+*]:ml-auto がある", () => {
    expect(scan().violations.map((v) => v.where)).toEqual([]);
  });

  it("読めない部分があって判定できない箇所が無い", () => {
    // fail-closed (#262)。読めない式を素通りさせると、そのタグは検査されていないのに
    // 緑になる。導入時点の実測は 0 件で、初期コストは無かった。
    expect(scan().unprovable.map((u) => u.where)).toEqual([]);
  });

  it("判定の 4 値を直接固定する", () => {
    // scan() は現在の repo に依存するので、判定そのものはここで押さえる。
    expect(classify(["flex", "flex-wrap", "justify-between"], false)).toBe("violation");
    expect(classify(["flex", "flex-wrap", "justify-between", REMEDY], false)).toBe("satisfied");
    expect(classify(["flex", "flex-wrap", "justify-between"], true)).toBe("unprovable");
    // 手当てが読めていれば、読めない受け渡しがあっても満たしている。
    expect(classify(["flex-wrap", "justify-between", REMEDY], true)).toBe("satisfied");
    // 片方だけなら対象外。`cn(base, className)` のプリミティブを巻き込まない。
    expect(classify(["flex-wrap", "justify-end"], true)).toBe("n/a");
    expect(classify(["justify-between"], true)).toBe("n/a");
  });

  it("事故の原文を negative control で検知する", () => {
    // 実際に事故っていた行の原文を使う (#262)。合成ケースだけで満足しない。
    // handoff-form.tsx:88 の原文。
    expect(
      violatesTag('<Card.Body className="flex flex-wrap items-center justify-between gap-3">'),
    ).toBe(true);
    // stores/page.tsx:57 の原文。flex-wrap が末尾に来る順序違い。
    expect(
      violatesTag('<div className="flex items-center justify-between gap-2 flex-wrap">'),
    ).toBe(true);
    // actions/[storeId]/page.tsx:44 の原文。items-start でも同じ。
    expect(
      violatesTag('<div className="flex items-start justify-between gap-3 flex-wrap">'),
    ).toBe(true);

    // 是正後は緑に転じる (弁別性)。「何を書いても落ちる」ではない。
    expect(
      violatesTag('<Card.Body className="flex flex-wrap items-center justify-between gap-3 [&>*+*]:ml-auto">'),
    ).toBe(false);
  });

  it("規則の外側を巻き込まない", () => {
    // 折り返さない行は justify-between だけで右端に届く。
    expect(violatesTag('<div className="flex items-center justify-between gap-2">')).toBe(false);
    // 寄せが無い折り返しは、そもそも左詰めが期待される挙動。
    expect(violatesTag('<div className="flex flex-wrap gap-2">')).toBe(false);
    // 1 要素だけ残った行が左端へ落ちるのは space-between のみ。
    expect(violatesTag('<div className="flex flex-wrap items-center justify-end gap-2">')).toBe(false);
    expect(violatesTag('<div className="flex flex-wrap items-center justify-center gap-2">')).toBe(false);
    // 前方一致で誤爆しない。
    expect(
      violatesTag(`<div className="flex ${WRAP_REVERSE} justify-between">`),
    ).toBe(false);
  });

  it("前方一致の needle が実在するクラスで、かつ基底そのものではない (#276)", async () => {
    // `hidden()` の断片を打ち間違えると、`WRAP` と前方一致しない別の文字列になる。
    // `violatesTag` は "n/a" を返して `toBe(false)` が通るため、上の「前方一致で
    // 誤爆しない」が**検査になっていないまま緑**になる (実測: 断片を壊しても全件
    // green だった)。実在の判定は模型ではなく Tailwind 自身に任せる。
    const empty = Buffer.byteLength(await buildCss([]));
    expect(
      Buffer.byteLength(await buildCss([WRAP_REVERSE])),
      "needle が実在するクラスではない",
    ).toBeGreaterThan(empty);
    // 前方一致の検査として成立していること。`WRAP` で始まり `WRAP` ではない。
    expect(WRAP_REVERSE.startsWith(WRAP)).toBe(true);
    expect(WRAP_REVERSE).not.toBe(WRAP);
  });

  it("式で分割して書かれても合併して拾う", () => {
    // #262 の 4 形。静的リテラル以外で書かれた瞬間に穴が開くことを防ぐ。
    expect(
      violatesTag('<div className={cn("flex flex-wrap", busy && "justify-between")} />'),
    ).toBe(true);
    expect(
      violatesTag('<div className={editing ? "flex flex-wrap justify-between" : undefined} />'),
    ).toBe(true);
    expect(
      violatesTag('<div className={`flex flex-wrap items-center justify-between gap-3`} />'),
    ).toBe(true);
    // 手当てが式の別の枝にあっても合併されるので緑。
    expect(
      violatesTag('<div className={cn("flex flex-wrap justify-between", "[&>*+*]:ml-auto")} />'),
    ).toBe(false);
  });
});
