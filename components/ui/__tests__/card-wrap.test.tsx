/**
 * `Card.Header` / `Card.Footer` が狭幅で折り返すこと (#270) を、実際の描画結果と
 * リポジトリ走査で固定する。
 *
 * ## 変更前は何が壊れていたか
 *
 * どちらも `flex` だけで `flex-wrap` を持たなかった。`Card` は `overflow-hidden` を持ち
 * (`card.tsx`)、`Button` の基底は `whitespace-nowrap` を持つ (`button.tsx`) ため、
 * **縮まないものが逃げ場のない箱に入っている**状態で、右側の操作は狭幅で切り取られて
 * 押せなくなっていた。`app/globals.css` の `overflow-x: clip`
 * (`docs/architecture/responsive.md` §6) があるので横スクロールバーすら出ず、
 * 症状は「はみ出す」ではなく「押せない」として現れる。
 *
 * 375px の実効幅 301px に対し、`sales-progress-card` の編集モードのヘッダは 322px。
 * 21px ぶん「保存」が消えていた。
 *
 * ## このファイルが見る層 (`docs/architecture/responsive.md` §5)
 *
 * - ④ 実描画検査 — `renderToStaticMarkup` で出た class を見る
 * - ① ソース逐語検査 — 基底クラス列の手書きコピーが `card.tsx` の外に無い
 *
 * ## 消費者側の走査ガードは置かない (置こうとして失敗した記録)
 *
 * 当初は「操作ラッパへ `ml-auto` を書き、`Card.Header` ブロックを走査して強制する」
 * 設計だった。`{editing ? <保存群/> : <編集/>}` のように**分岐を持つヘッダでは、
 * ブロック内に `ml-auto` が 1 つでもあれば通る**ため、negative control
 * (編集モード側の `ml-auto` だけを外す) が**素通りした**。つまりこの PR が直した
 * 回帰そのものを検出できないガードだった。
 *
 * 分岐まで読む走査は壊れやすく、壊れたことも分からない。`Card.Header` 側の
 * `[&>*+*]:ml-auto` で構造的に効かせ、検知の問題ごと消した。
 */

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { load } from "cheerio";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Card } from "../card";
import { buildCss, normalize } from "./support/build-css";

const ROOT = path.resolve(import.meta.dirname, "../../..");

/**
 * 最初の `<div>` の class 文字列。抽出自体を確かめて空虚な green を防ぐ。
 *
 * **HTML エンティティを戻す。** `renderToStaticMarkup` は属性値をエスケープするので、
 * 任意バリアント (`[&>*+*]:ml-auto` など) は `[&amp;&gt;*+*]:ml-auto` として出てくる。
 * 戻さずに `toContain` すると、クラスが正しく付いていても永遠に落ちる。
 */
function rootClasses(html: string): string {
  const match = /^<div[^>]*class="([^"]*)"/.exec(html);
  const classes = match?.[1];
  expect(classes, "ルートの <div> を抽出できていない").toBeTypeOf("string");
  return classes!
    .replace(/&(?:amp|lt|gt|quot|#x27|#39);/g, (entity) =>
      ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#x27;": "'", "&#39;": "'" })[entity]!,
    )
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

const header = () =>
  rootClasses(
    renderToStaticMarkup(
      <Card.Header>
        <Card.Title>現在の営業状況</Card.Title>
        <div className="flex items-center gap-2">
          <button type="button">キャンセル</button>
          <button type="button">保存</button>
        </div>
      </Card.Header>,
    ),
  );

const footer = () =>
  rootClasses(
    renderToStaticMarkup(
      <Card.Footer>
        <button type="button">キャンセル</button>
        <button type="button">記録を保存</button>
      </Card.Footer>,
    ),
  );

describe("Card.Header / Card.Footer の折り返し", () => {
  it.each([
    ["Card.Header", header],
    ["Card.Footer", footer],
  ])("%s は flex-wrap を持つ", (_label, classesOf) => {
    // 事故: これが無いと、右側の操作が overflow-hidden に切り取られて押せなくなる。
    expect(classesOf().split(" ")).toContain("flex-wrap");
  });

  it("Card.Header の既存のレイアウト契約は据え置き", () => {
    // 折り返しを足しただけで、広幅の見た目は 1px も変えない。
    const classes = header().split(" ");

    expect(classes).toContain("flex");
    expect(classes).toContain("items-center");
    expect(classes).toContain("justify-between");
    expect(classes).toContain("gap-3");
    expect(classes).toContain("px-5");
    expect(classes).toContain("py-4");
    expect(classes).toContain("border-b");
  });

  it("Card.Footer の既存のレイアウト契約は据え置き", () => {
    const classes = footer().split(" ");

    expect(classes).toContain("flex");
    expect(classes).toContain("items-center");
    expect(classes).toContain("justify-end");
    expect(classes).toContain("gap-2");
    expect(classes).toContain("px-5");
    expect(classes).toContain("py-3");
    expect(classes).toContain("border-t");
  });

  it.each([
    ["Card.Header", header],
    ["Card.Footer", footer],
  ])("%s は min-w-0 を持たない (意図的)", (_label, classesOf) => {
    // §4.5 は flex-wrap と併せて min-w-0 の欠如も挙げるが、どちらの子にも
    // `truncate` は無い。min-w-0 は min-content を割ることを許す指定なので、
    // 折り返し先がある今の構成では要素どうしの重なりを招くだけになる。
    // `truncate` を持つ子を足すときに、そのとき一緒に入れる。
    expect(classesOf().split(" ")).not.toContain("min-w-0");
  });

  it("className は基底の後に来るので消費者が上書きできる", () => {
    // 逐語コピーを Card.Footer へ寄せるとき (store-new-form 等) に rounded-md を
    // 足せることを担保する。cn は素の clsx なので順序がそのまま出力順になる。
    const html = renderToStaticMarkup(<Card.Footer className="rounded-md" />);

    expect(rootClasses(html).split(" ")).toContain("rounded-md");
    expect(rootClasses(html)).toMatch(/flex-wrap.*rounded-md/);
  });
});

// ---------------------------------------------------------------------------
// リポジトリ走査
// ---------------------------------------------------------------------------

/**
 * 本番の JSX だけを集める。`__tests__` を外すのは、**このファイル自身が検査対象の
 * 文字列を本文に持つ**ため。除外しないと自分に当たって落ちる (逆向きの自己ヒット)。
 * 走査系のガードで繰り返し踏まれている罠なので、除外理由をここへ残す。
 */
async function collectTsxFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") continue;
      files.push(...(await collectTsxFiles(fullPath)));
    } else if (entry.isFile() && fullPath.endsWith(".tsx")) {
      files.push(fullPath);
    }
  }
  return files;
}

async function scanTargets(): Promise<Array<{ file: string; source: string }>> {
  const files = [
    ...(await collectTsxFiles(path.join(ROOT, "app"))),
    ...(await collectTsxFiles(path.join(ROOT, "components"))),
  ];
  return Promise.all(
    files.map(async (file) => ({
      file: path.relative(ROOT, file),
      source: await readFile(file, "utf8"),
    })),
  );
}

describe("Card.Header に置いた操作は折り返しても右寄せを保つ", () => {
  it("2 番目以降の子へ margin-left: auto を与える", () => {
    // justify-content は行ごとに効くので、操作群だけが落ちた 2 行目は
    // justify-between でも左寄せになる。auto マージンがそこを埋める。
    expect(header().split(" ")).toContain("[&>*+*]:ml-auto");
  });

  it("見出しだけのヘッダでは誰にも当たらない", async () => {
    // 旧版は「子が 1 つでも 2 つでも基底クラス列は同じ」を見ていたが、`CardHeader` の
    // className は children に依存しないので**恒真**だった。last-child 版へ差し替えても
    // 落ちない (PR #271 のレビューで実測)。テスト名が主張していた「見出しを右へ寄せない」を
    // 1 バイトも検証していなかった。
    //
    // 実装が出したクラスを Tailwind へ通し、返ってきた入れ子セレクタを**実際のマークアップへ
    // 当てて誰に効くかを数える**。これが「2 番目以降」と「last-child」を分ける唯一の検査。
    const token = header()
      .split(" ")
      .find((c) => c.endsWith(":ml-auto"));
    expect(token, "Card.Header に auto マージンの任意バリアントが無い").toBeTypeOf("string");

    const css = normalize(await buildCss([token!]));
    const nested = /\{ (&[^{]*?) \{ margin-left: auto/.exec(css)?.[1];
    expect(nested, "入れ子セレクタを取り出せていない").toBeTypeOf("string");
    // `&` を「そのクラスを持つ要素」へ置換する。属性セレクタで指すのは、任意バリアントの
    // クラス名がそのままでは CSS セレクタとして書けない (要エスケープ) ため。
    const selector = nested!.replace("&", `[class~="${token}"]`);

    const only = load(
      renderToStaticMarkup(
        <Card.Header>
          <Card.Title>AI店舗調査結果</Card.Title>
        </Card.Header>,
      ),
    );
    const withOps = load(
      renderToStaticMarkup(
        <Card.Header>
          <Card.Title>現在の営業状況</Card.Title>
          <div id="ops" />
        </Card.Header>,
      ),
    );

    // 事故: last-child 版だと、見出しだけのヘッダで見出しが右へ飛ぶ。
    expect(only(selector), "子が 1 つのヘッダで当たってはいけない").toHaveLength(0);
    expect(withOps(selector), "2 番目の子にだけ当たる").toHaveLength(1);
    expect(withOps(selector).attr("id")).toBe("ops");
  });

  it("Card.Footer は justify-end なので同じ指定を持たない", () => {
    // 折り返した行も右寄せのまま。二重に持たせると意図の出所が 2 つになる。
    expect(footer().split(" ")).not.toContain("[&>*+*]:ml-auto");
  });
});

describe("基底クラス列の手書きコピーが無い", () => {
  it.each([
    ["Card.Header", "px-5 py-4 border-b"],
    ["Card.Footer", "px-5 py-3 border-t"],
  ])("%s の寸法をコピーした .tsx が card.tsx の外に無い", async (_label, signature) => {
    // 事故: store-new-form.tsx / store-edit-form.tsx が Card.Footer の基底クラス列を
    // 素の div へ逐語コピーしており、プリミティブへ flex-wrap を足しても届かなかった
    // (#270)。negative control は、この 2 箇所の原文をそのまま戻すこと。
    const copies = (await scanTargets())
      .filter(({ file }) => file !== path.join("components", "ui", "card.tsx"))
      .filter(({ source }) => source.includes(signature))
      .map(({ file }) => file);

    expect(copies).toEqual([]);
  });
});
