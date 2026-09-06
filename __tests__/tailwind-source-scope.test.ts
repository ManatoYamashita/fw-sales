/**
 * Tailwind が**どのファイルを読むか**を固定する (#274。#265 の一般化)。
 *
 * ## 何を防ぐのか
 *
 * Tailwind v4 の既定は自動ソース検出で、リポジトリを丸ごと走査する。この既定のままだと
 * 実装が使っていないクラス名でも、**テストへ渡した引数・JSDoc・ドキュメントの散文に
 * 現れただけで本番 CSS に規則が生まれる**。#265 はその 1 例 (テストの needle が
 * 消したはずのクラスを延命させていた) で、当時は needle を実行時連結して隠す形で塞いだ。
 *
 * だがそれは既知のクラスにしか効かない。実測すると、同じ機構で 18 個のセレクタが
 * 本番 CSS へ入っており、その中には `transition-property` の値が不正な規則まであった。
 * 供給元には英文散文の中の `collapse` / `lowercase` も含まれ、**ドキュメントで普通の
 * 英単語を書くたびに Tailwind のユーティリティ名を避ける**運用は成立しない。
 *
 * そこで `app/globals.css` で走査範囲そのものを絞った。このテストはその設定が
 * 効いていること (G1) と、絞りすぎていないこと (G2) の両方を見る。
 *
 * ## negative control
 *
 * - `source(none)` を外す → 自動ソース検出が復活し「@source の外を走査しない」が落ちる
 * - `@source not` の `__tests__` 行を外す → テストが復活し「テストを走査しない」が落ちる
 * - `@source not` の Markdown 行を外す → 散文が復活し「Markdown を走査しない」が落ちる
 * - `@source "../components"` を外す → G2 が欠落パスを列挙して落ちる
 */

import { describe, expect, it } from "vitest";
import {
  gitTrackedFiles,
  isTestPath,
  scanProductionSources,
} from "@/components/ui/__tests__/support/tailwind-sources";

const scan = await scanProductionSources();
const scanned = new Set(scan.files);
const tracked = await gitTrackedFiles();

/** 実行時にマークアップを生むファイル。JSX を書けるのは `.tsx` だけ。 */
const runtimeMarkupFiles = tracked.filter(
  (file) => file.endsWith(".tsx") && !isTestPath(file),
);

describe("Tailwind の走査範囲", () => {
  it("走査が空振りしていない", () => {
    // 0 件なら以下の検査が全部「該当なし」で空虚に green になる。
    expect(scan.files.length).toBeGreaterThan(200);
    expect(scan.candidates.length).toBeGreaterThan(1000);
    expect(tracked.length).toBeGreaterThan(200);
    expect(scan.declaredBases.length).toBeGreaterThan(0);
    // 実装が書いた任意値クラスが候補に入っていること。走査が実際にクラスを
    // 拾えている証拠で、ここが 0 なら「読んだが何も取れていない」状態を見逃す。
    expect(scan.candidates.some((c) => c.includes("["))).toBe(true);
  });

  it("Markdown を走査しない", () => {
    const markdown = scan.files.filter((file) => file.endsWith(".md"));
    expect(markdown, `散文が本番 CSS を動かす: ${markdown.slice(0, 10).join(", ")}`)
      .toHaveLength(0);
  });

  it("テストのためのファイルを走査しない", () => {
    const tests = scan.files.filter(isTestPath);
    expect(tests, `テストの文字列が本番 CSS を動かす: ${tests.slice(0, 10).join(", ")}`)
      .toHaveLength(0);
  });

  it("自動ソース検出が無効になっている", () => {
    // 有効だとリポジトリを丸ごと読むので、`@source not` を並べても
    // **書き忘れたものが全部入ってくる**。既定を「読まない」側へ倒しておく。
    expect(scan.autoDetection).toBe(false);
  });

  it("明示した @source の外を走査しない", () => {
    // 上と対になる検査。あちらは設定の字面、こちらはその結果を見る。
    // 自動ソース検出が復活すると、`@source` に書いていない `drizzle/` や
    // `scripts/` や `.kiro/` が読まれ、ここが落ちる。
    const outside = scan.files.filter(
      (file) => !scan.declaredBases.some((base) => file.startsWith(`${base}/`)),
    );
    expect(
      outside,
      `@source に無いディレクトリを走査している: ${outside.slice(0, 10).join(", ")}`,
    ).toHaveLength(0);
  });

  it("マークアップを生む実装ファイルが全部走査対象に入っている", () => {
    // 走査から漏れたファイルのクラスは **無言で** CSS にならない (例外は出ない)。
    // 新しい実装ディレクトリを足したら `app/globals.css` へ `@source` を足すこと。
    const missing = runtimeMarkupFiles.filter((file) => !scanned.has(file));
    expect(
      missing,
      `走査対象から漏れている実装ファイル (app/globals.css に @source を足すこと): ${missing.slice(0, 10).join(", ")}`,
    ).toHaveLength(0);
  });

  it("検査対象の実装ファイルを取り出せている", () => {
    // 上の検査は「漏れが 0 件」を見るので、対象が 0 件でも green になる。
    expect(runtimeMarkupFiles.length).toBeGreaterThan(50);
  });
});
