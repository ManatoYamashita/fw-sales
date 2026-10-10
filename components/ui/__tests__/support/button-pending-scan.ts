/**
 * `Button` の処理中表示の書き方を AST で検査する (#326)。
 *
 * 文字列の正規表現ではなく TypeScript の構文木を見る。属性が複数行に渡る、
 * 条件が `a || b` で組まれている、といった書き方の揺れで空振りしないため。
 *
 * 検出するもの:
 * - `manual-spinner`: `Button` の子に `Spinner` を手で置いている。
 *   処理中表示は `pending` prop に任せる
 * - `disabled-toggle`: `disabled={x}` と、子の中の `x ? "保存中…" : "保存"` のような
 *   同じ条件の分岐を併せ持つ。これは処理を起動したボタン本人なので `pending={x}` にする
 *   (キャンセルなど、文言を切り替えない隣のボタンは対象外)
 * - `busy-label`: `pending` を持たないのに、子の分岐で「保存中…」のような
 *   処理中の文言へ切り替えている。`disabled` と別の変数で切り替えている書き方
 *   (`disabled={isAnyChanging}` と `isChangingThis ? "変更中…"` など) を拾う
 */

import ts from "typescript";

export type PendingViolationKind =
  | "manual-spinner"
  | "disabled-toggle"
  | "busy-label";

export interface PendingViolation {
  kind: PendingViolationKind;
  line: number;
  text: string;
}

function tagNameOf(node: ts.JsxElement | ts.JsxSelfClosingElement): string {
  const tag = ts.isJsxElement(node) ? node.openingElement.tagName : node.tagName;
  return tag.getText();
}

function attributeExpression(
  opening: ts.JsxOpeningElement,
  name: string,
): ts.Expression | undefined {
  for (const prop of opening.attributes.properties) {
    if (!ts.isJsxAttribute(prop) || prop.name.getText() !== name) continue;
    const init = prop.initializer;
    if (init && ts.isJsxExpression(init) && init.expression) {
      return init.expression;
    }
  }
  return undefined;
}

/** `a || b || c` を葉の式へ分解し、括弧を外したテキストの集合にする。 */
function disjuncts(expression: ts.Expression): Set<string> {
  const out = new Set<string>();
  const visit = (e: ts.Expression) => {
    if (ts.isParenthesizedExpression(e)) return visit(e.expression);
    if (
      ts.isBinaryExpression(e) &&
      e.operatorToken.kind === ts.SyntaxKind.BarBarToken
    ) {
      visit(e.left);
      visit(e.right);
      return;
    }
    out.add(e.getText());
  };
  visit(expression);
  return out;
}

/** 子孫の `x ? … : …` と `x && …` の条件 (括弧を外したテキスト) を集める。 */
function childConditions(element: ts.JsxElement): string[] {
  const out: string[] = [];
  const unwrap = (e: ts.Expression): ts.Expression =>
    ts.isParenthesizedExpression(e) ? unwrap(e.expression) : e;
  const visit = (node: ts.Node) => {
    if (ts.isConditionalExpression(node)) {
      out.push(unwrap(node.condition).getText());
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
    ) {
      out.push(unwrap(node.left).getText());
    }
    ts.forEachChild(node, visit);
  };
  for (const child of element.children) visit(child);
  return out;
}

/** 「保存中…」「サインイン中...」のような処理中の文言。 */
const BUSY_LABEL = /中(…|\.\.\.)$/;

/** 子孫の三項演算子のうち、真の側が処理中の文言の文字列であるものがあるか。 */
function hasBusyLabel(element: ts.JsxElement): boolean {
  let found = false;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (ts.isConditionalExpression(node)) {
      let whenTrue: ts.Expression = node.whenTrue;
      while (ts.isParenthesizedExpression(whenTrue)) whenTrue = whenTrue.expression;
      if (
        (ts.isStringLiteral(whenTrue) ||
          ts.isNoSubstitutionTemplateLiteral(whenTrue)) &&
        BUSY_LABEL.test(whenTrue.text)
      ) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  for (const child of element.children) visit(child);
  return found;
}

function containsSpinner(element: ts.JsxElement): boolean {
  let found = false;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (
      (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) &&
      tagNameOf(node) === "Spinner"
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  for (const child of element.children) visit(child);
  return found;
}

export function scanButtonPending(
  source: string,
  fileName = "input.tsx",
): PendingViolation[] {
  const sf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const violations: PendingViolation[] = [];
  const report = (kind: PendingViolationKind, node: ts.Node) => {
    violations.push({
      kind,
      line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
      text: node.getText(sf).split("\n")[0]!.trim(),
    });
  };

  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node) && tagNameOf(node) === "Button") {
      if (containsSpinner(node)) report("manual-spinner", node);
      // `pending` を持つボタンは、どの条件が処理中かを作者が宣言済み。残りの
      // 分岐 (「探索済み」の表示など) は処理中表示ではないので見ない。
      const hasPending = node.openingElement.attributes.properties.some(
        (p) => ts.isJsxAttribute(p) && p.name.getText() === "pending",
      );
      const disabled = attributeExpression(node.openingElement, "disabled");
      if (disabled && !hasPending) {
        const flags = disjuncts(disabled);
        if (childConditions(node).some((c) => flags.has(c))) {
          report("disabled-toggle", node);
        } else if (hasBusyLabel(node)) {
          report("busy-label", node);
        }
      } else if (!hasPending && hasBusyLabel(node)) {
        report("busy-label", node);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return violations;
}
