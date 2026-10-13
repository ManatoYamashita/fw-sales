/**
 * ネイティブの `<select>` を描画している箇所を AST で探す (#334)。
 *
 * アプリのプルダウンは共通 `Select` (`components/ui/select.tsx`) に統一した。
 * ネイティブの `<select>` は開いたときにブラウザ / OS 標準の候補パネルを出すので、
 * 1 箇所でも残ると「全画面で独自 UI」という方針が崩れる。
 *
 * 文字列の正規表現ではなく TypeScript の構文木を見る。コメントや JSDoc に書いた
 * 「ネイティブの `<select>`」という説明へ自己ヒットせず (ゾンビテスト化を避ける)、
 * 属性の改行や書き方の揺れでも空振りしないため。
 *
 * 要素を作る書き方は次の 4 形 + JSX を拾う。
 * - `jsx`: `<select ...>`
 * - `literal`: `createElement("select")` / `jsx("select", ...)` (静的な文字列リテラル)
 * - `template`: `` createElement(`select`) `` (テンプレートリテラル)
 * - `expression`: `createElement(cond ? "select" : "input")` (式の中のリテラル)
 * - `variable`: `const Tag = "select"; <Tag />` / `createElement(tag)` (変数参照)
 */

import ts from "typescript";

export type NativeSelectForm =
  | "jsx"
  | "literal"
  | "template"
  | "expression"
  | "variable";

export interface NativeSelectHit {
  form: NativeSelectForm;
  line: number;
  text: string;
}

/** 要素を作る関数とみなす呼び出し名 (末尾一致)。 */
const ELEMENT_FACTORIES = new Set([
  "createElement",
  "jsx",
  "jsxs",
  "jsxDEV",
]);

const TAG = "select";

function isSelectLiteral(node: ts.Node): boolean {
  return (
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
    node.text.toLowerCase() === TAG
  );
}

/** 式の部分木に `"select"` のリテラルが含まれるか。 */
function containsSelectLiteral(node: ts.Node): boolean {
  if (isSelectLiteral(node)) return true;
  return ts.forEachChild(node, (child) => containsSelectLiteral(child) || undefined) ?? false;
}

function calleeName(call: ts.CallExpression): string | undefined {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return undefined;
}

function classifyArgument(
  argument: ts.Expression,
  tainted: ReadonlySet<string>,
): NativeSelectForm | null {
  if (ts.isStringLiteral(argument) && isSelectLiteral(argument)) return "literal";
  if (ts.isNoSubstitutionTemplateLiteral(argument) && isSelectLiteral(argument)) {
    return "template";
  }
  if (ts.isIdentifier(argument)) {
    return tainted.has(argument.text) ? "variable" : null;
  }
  return containsSelectLiteral(argument) ? "expression" : null;
}

export function findNativeSelects(
  source: string,
  fileName = "source.tsx",
): NativeSelectHit[] {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );

  // `"select"` を値に持ちうる変数。初期化子の式のどこかにリテラルがあれば対象にする。
  const tainted = new Set<string>();
  const collect = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      containsSelectLiteral(node.initializer)
    ) {
      tainted.add(node.name.text);
    }
    ts.forEachChild(node, collect);
  };
  collect(file);

  const hits: NativeSelectHit[] = [];
  const push = (form: NativeSelectForm, node: ts.Node) => {
    hits.push({
      form,
      line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
      text: node.getText(file).split("\n")[0] ?? "",
    });
  };

  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName;
      if (ts.isIdentifier(tag)) {
        if (tag.text === TAG) push("jsx", node);
        else if (tainted.has(tag.text)) push("variable", node);
      }
    } else if (ts.isCallExpression(node)) {
      const name = calleeName(node);
      const first = node.arguments[0];
      if (name && ELEMENT_FACTORIES.has(name) && first) {
        const form = classifyArgument(first, tainted);
        if (form) push(form, node);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return hits;
}
