/**
 * Server Action が画面へ返す失敗の文を固定する (#327)。
 *
 * - 文字列で書いた失敗の文は日本語にする
 * - catch した例外の中身 (`err.message` など) を失敗の文へ流さない。DB や外部 API の
 *   英語の文・制約名・テーブル名が、そのままトーストに出てしまうため。詳細はログへ
 *   (PR #144 以来の「UI とログの二系統」)
 *
 * 判定は TypeScript の構文木で行う。
 */

import { readdirSync, readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const JAPANESE = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;

/**
 * 例外を受け取り、画面用の日本語の文を作る変換関数。この引数の中で例外を参照するのは
 * 「中身をそのまま流す」ことにならないので許す。`String(err)` のような汎用の関数で
 * 素通しする書き方を許さないため、「関数呼び出しなら何でも可」にはしない。
 */
const USER_MESSAGE_MAPPERS = new Set([
  "toUserFacingPlacesMessage",
  "clientErrorToMessage",
  "formatUserMessage",
  "parsePostgresError",
]);

export function failureMessageViolations(source: string, fileName = "x.ts"): string[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const at = (node: ts.Node) => `${fileName}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`;

  const catchVariables = (node: ts.Node): Set<string> => {
    const names = new Set<string>();
    for (let cur: ts.Node | undefined = node; cur; cur = cur.parent) {
      if (ts.isCatchClause(cur) && cur.variableDeclaration && ts.isIdentifier(cur.variableDeclaration.name)) {
        names.add(cur.variableDeclaration.name.text);
      }
    }
    return names;
  };

  const references = (node: ts.Node, names: Set<string>): boolean => {
    if (
      ts.isCallExpression(node) &&
      USER_MESSAGE_MAPPERS.has(node.expression.getText(sf))
    ) {
      return false;
    }
    if (ts.isIdentifier(node) && names.has(node.text)) return true;
    return node.getChildren(sf).some((child) => references(child, names));
  };

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(sf) === "failure") {
      const arg = node.arguments[0];
      if (arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg) || ts.isTemplateExpression(arg))) {
        const text = ts.isTemplateExpression(arg) ? arg.head.text + arg.templateSpans.map((s) => s.literal.text).join("") : arg.text;
        if (!JAPANESE.test(text)) out.push(`${at(node)} not-japanese`);
      }
      const caught = catchVariables(node);
      if (arg && caught.size > 0 && references(arg, caught)) {
        out.push(`${at(node)} leaks-caught-error`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

describe("failureMessageViolations の検知力", () => {
  it("#327 以前の引き継ぎ作成 (原文): 例外の文をそのまま返すのを検出する", () => {
    const before = `
try {
  await create();
} catch (err) {
  return failure(err instanceof Error ? err.message : "作成に失敗しました");
}`;
    expect(failureMessageViolations(before)).toEqual(["x.ts:5 leaks-caught-error"]);
  });

  it("#327 以前のインポート (原文): 日本語の前置きに例外の文を連結するのも検出する", () => {
    const before = `
try {
  JSON.parse(raw);
} catch (e) {
  return failure(
    e instanceof Error ? \`JSON解析失敗: \${e.message}\` : "インポートに失敗しました",
  );
}`;
    expect(failureMessageViolations(before)).toEqual(["x.ts:5 leaks-caught-error"]);
  });

  it("英語だけの失敗の文を検出する", () => {
    expect(failureMessageViolations(`failure("Not found");`)).toEqual(["x.ts:1 not-japanese"]);
    expect(failureMessageViolations("failure(`Invalid ${key}`);")).toEqual(["x.ts:1 not-japanese"]);
  });

  it("例外を汎用の関数で文字列にして流すのは検出する", () => {
    const source = `
try { await run(); } catch (err) {
  return failure(String(err));
}`;
    expect(failureMessageViolations(source)).toEqual(["x.ts:3 leaks-caught-error"]);
  });

  it("catch の中でも、例外を変換関数に通した文 (変換後の日本語) までは止めない", () => {
    // 変換関数が UI 用の文を作る設計 (formatUserMessage など) は許す。例外をそのまま流すのとは区別する。
    const source = `
try { await run(); } catch (err) {
  const parsed = parsePostgresError(err);
  return failure(formatUserMessage(parsed, "店舗の削除に失敗しました"));
}
try { await run(); } catch (e) {
  return failure(toUserFacingPlacesMessage(e, "検索に失敗しました", "search"));
}`;
    expect(failureMessageViolations(source)).toEqual([]);
  });

  it("日本語の定型文は通す", () => {
    expect(failureMessageViolations(`failure("店舗が見つかりませんでした");`)).toEqual([]);
  });
});

describe("lib/actions 全体", () => {
  const files = readdirSync("lib/actions").filter((f) => f.endsWith(".ts"));

  it("走査対象が空でない", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("失敗の文は日本語で、catch した例外の中身を含まない", () => {
    const violations = files.flatMap((f) =>
      failureMessageViolations(readFileSync(`lib/actions/${f}`, "utf8"), f),
    );
    expect(violations).toEqual([]);
  });
});
