/**
 * エリア検索の外部エラー非露出ガード (Issue #201)
 *
 * `lib/actions/__tests__/area-search-actions.test.ts` と
 * `lib/places/__tests__/google.test.ts` が振る舞いを検証するのに対し、本ファイルは
 * **ソースの形**を機械的に検査して同じ漏洩パターンの再発を CI で止める。
 *
 * 振る舞いテストだけでは、新しい catch や新しい API 呼び出しが追加されたときに
 * 「テストが書かれなかった経路」から再び `e.message` が UI へ流れうる。これは
 * `app/(main)/stores/__tests__/area-search-no-deep-research.test.ts` と同じ手法。
 *
 * 関連: Issue #201, Issue #129 (A7 / A8)
 */

import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

const REPO_ROOT = process.cwd();

async function readSource(relativePath: string): Promise<string> {
  return readFile(path.join(REPO_ROOT, relativePath), "utf8");
}

/** 生の `Error.message` をそのまま UI 向けの値として使う典型パターン。 */
const RAW_MESSAGE_PASSTHROUGH = /\b(e|err|error)\s+instanceof\s+Error\s*\?\s*\1\.message/;

describe("エリア検索が外部エラーの生文言を UI へ渡さない (#201)", () => {
  /**
   * Client Component には `Error.message` の正当な用途が無い (診断ログは
   * サーバー側が担う) ため、出現そのものを禁止できる。
   *
   * 対する `lib/actions/area-search-actions.ts` では `logAreaSearchFailure` が
   * 構造化ログへ `message` を載せる正当な用途を持つため、この形では検査せず、
   * 「UI へ出る値」= `failure()` の引数を直接検査する (次の it)。
   */
  it.each([
    "app/(main)/stores/new/_components/area-search-results.tsx",
    "app/(main)/stores/new/_components/place-result-list.tsx",
    "app/(main)/stores/new/_components/registration-mode-card.tsx",
    // 地図も同じエリア検索画面の Client Component。旧実装は `errorMessage` state へ
    // 生の `Error.message` を入れて dev ビルドでのみ描画していたが、診断は
    // `console.error("[AreaSearchMap] ...", error)` が Error 全体 + スタックごと
    // 担っており表示は情報を増やしていなかったため撤去した (#221 review)。
    "app/(main)/stores/new/_components/area-search-map.tsx",
  ])("%s に `e instanceof Error ? e.message` 形の透過が無い", async (relativePath) => {
    const source = await readSource(relativePath);
    expect(
      source,
      `${relativePath}: 生の Error.message を UI 値として使わないこと。` +
        "Client Component は定型文言を使う (診断はサーバー側の構造化ログが担う)。",
    ).not.toMatch(RAW_MESSAGE_PASSTHROUGH);
  });

  it("area-search-actions.ts が Error.message を使うのは診断ログの中だけ", async () => {
    const source = await readSource("lib/actions/area-search-actions.ts");
    const occurrences = (source.match(/\berr(?:or)?\.message\b|\be\.message\b/g) ?? []).length;

    // logAreaSearchFailure 内の 1 箇所のみ (Postgres 解析が空振りしたときの生 message)。
    // 増えた場合は UI 経路へ流れていないかを必ず確認すること。
    expect(occurrences).toBe(1);
  });

  it("area-search-actions.ts の failure() 引数は定型文言か sanitize 関数の戻り値だけ", async () => {
    const source = await readSource("lib/actions/area-search-actions.ts");

    // `failure(` の直後 (改行・インデントを飛ばして) に来てよいのは、
    // 文字列リテラル (定型文言 / テンプレートリテラル) か `toUserFacingPlacesMessage(` のみ。
    // 変数や式を渡す形は、そこから外部エラーの生文言が UI へ流れる余地を作る。
    const callSites = [...source.matchAll(/\bfailure\(\s*/g)];
    expect(callSites.length).toBeGreaterThan(0);

    for (const match of callSites) {
      const head = source.slice(match.index + match[0].length, match.index + match[0].length + 40);
      expect(
        head,
        `failure() に定型文言でも sanitize 済みでもない値を渡しています: ${head}`,
      ).toMatch(/^(?:"|`|toUserFacingPlacesMessage\()/);
    }
  });

  it("失敗を握る catch はすべて診断ログを残す (#129 A8)", async () => {
    const source = await readSource("lib/actions/area-search-actions.ts");

    // ヘルパー定義 1
    // + ユーザーへ結果を返す catch 5 (search / details / legacy search / add / bulk)
    // + 握り潰す内部 catch 2 (候補DB 保存 / 候補DB 照合。#221 review でサニタイズ粒度を統一)
    expect((source.match(/logAreaSearchFailure\(/g) ?? []).length).toBe(8);

    // 生 Error を丸ごと渡す旧形式が同ファイルへ再び混ざらないこと。
    // (`logAreaSearchFailure` は scalar だけを出す構造化ログに統一する)
    // 行コメントは除去してから検査する。旧形式を「引用して説明する」コメントが
    // 実装内に残っており、素の grep では誤検知するため。
    const code = source.replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/console\.error\([^)]*,\s*e\s*\)/);
  });

  it("google.ts がレスポンス本文を Error へ埋め込まない", async () => {
    const source = await readSource("lib/places/google.ts");

    // `response.text()` の結果を throw に載せる旧実装のパターン
    expect(source).not.toMatch(/throw new Error\(`Places API エラー[^`]*\$\{text\}/);
    // 本文の読み取りは共通ヘルパーへ集約されている (呼び出し 3 経路 + 定義 1)
    expect((source.match(/response\.text\(\)/g) ?? []).length).toBe(1);
    expect((source.match(/throwPlacesApiError\(/g) ?? []).length).toBe(4);
  });

  it("google.ts が非 2xx 時に必ず型付きエラーを投げる", async () => {
    const source = await readSource("lib/places/google.ts");
    const notOkBlocks = source.match(/if \(!response\.ok\) \{[\s\S]*?\n  \}/g) ?? [];

    expect(notOkBlocks).toHaveLength(3);
    for (const block of notOkBlocks) {
      expect(block).toContain("throwPlacesApiError");
    }
  });
});
