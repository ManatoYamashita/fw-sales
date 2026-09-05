/**
 * JSX の開始タグから、利用側が渡した `className` を読み取る (#262)。
 *
 * ## なぜ独立モジュールなのか
 *
 * `class-conflicts.test.ts` の走査は当初 `className="..."` の**二重引用符リテラルしか
 * 読まなかった**。`className={...}` で書いたタグは値が取れず、そのタグ全体が無検査で
 * 通過していた。#248 の原文 (`className={editing ? undefined : "p-0"}`) がまさにその形で、
 * ガードは事故の実物を 1 件も落とせなかった。
 *
 * 読み取りは分岐が多く、それ自体が独立した争点になる。`docs/architecture/responsive.md`
 * §5 の「判断を純粋関数へ出す」に従い、衝突の判定 (`class-conflicts.test.ts`) とは
 * 別モジュールへ分けて、分岐を直接テストできるようにしてある。
 *
 * ## 読めない式の扱い
 *
 * クラスを供給しうるのに中身を読めない部分 (変数参照、メンバ参照、添字アクセス、
 * `${}` の中の識別子) があれば `unreadable` を立てる。呼び出し側はこれを
 * **fail-closed** に扱う。無検査で通すと、次に誰かがその形で書いた瞬間に無言で穴が開く。
 *
 * 導入時点のリポジトリに式形式の `className` は 1 件も無く (実測 77 件すべて二重引用符
 * リテラル)、fail-closed の初期コストは 0 だった。
 *
 * ## 既知の限定
 *
 * `cn({ hidden: isOpen })` のように**オブジェクトリテラルの条件付きクラス**は読めない側へ
 * 倒す。キーは ternary の `cond ? a : b` と、値は「クラスではない条件」と、それぞれ字面で
 * 区別できないため。読める形で書きたいときは `isOpen && "hidden"` を使う (clsx では等価)。
 */

/** 5 プリミティブの JSX 名。`Card.Body` のようにドットを含むものがある。 */
export type ScanTarget = string;

/**
 * `<Name ...>` の開始タグを列挙する。
 *
 * 属性値の中のアロー関数 (`onChange={(e) => ...}`) やジェネリクスの `>` で
 * タグを途中終了させないよう、文字列・テンプレート・波括弧の深さを追う。
 */
export function openingTags(
  source: string,
  component: ScanTarget,
): Array<{ text: string; index: number }> {
  const tags: Array<{ text: string; index: number }> = [];
  const marker = `<${component}`;
  let from = 0;

  while (true) {
    const index = source.indexOf(marker, from);
    if (index < 0) break;
    // `<Button` が `<ButtonGroup` の前方一致で当たるのを防ぐ。
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

/**
 * `name="..."` / `name='...'` の値。**引用符はどちらでもよい。**
 * 式 (`name={...}`) で書かれている場合は `undefined` を返す。
 */
export function readStringAttribute(
  tag: string,
  name: string,
): string | undefined {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(tag);
  if (match === null) return undefined;
  return match[1] ?? match[2];
}

/** `name={...}` の中身。波括弧の対応を取るので入れ子の式でも切り出せる。 */
export function readExpressionAttribute(
  tag: string,
  name: string,
): string | undefined {
  const match = new RegExp(`\\b${name}\\s*=\\s*\\{`).exec(tag);
  if (match === null) return undefined;

  const open = match.index + match[0].length - 1;
  let quote: '"' | "'" | "`" | null = null;
  let depth = 0;
  for (let i = open; i < tag.length; i += 1) {
    const char = tag[i];
    if (quote) {
      if (char === quote && tag[i - 1] !== "\\") quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") quote = char;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return tag.slice(open + 1, i);
    }
  }
  return undefined;
}

/** 識別子のうち、値として現れてもクラスを供給しないもの。 */
const LITERAL_KEYWORDS = new Set(["undefined", "null", "true", "false", "void"]);

type ExpressionRead = { tokens: string[]; unreadable: boolean };

/**
 * 式から**取り出せる文字列リテラルを全部合併**し、読めない部分の有無を返す。
 *
 * 合併して過検出側へ倒すのは、`baseClasses()` が動的 props に対して既に採っている
 * 「取りうる全値を合併する」方針と同じ。どちらの枝が実行されても衝突しないことを
 * 要求するので、三項演算子の両側が別々のクラスでも取りこぼさない。
 */
export function readClassExpression(expression: string): ExpressionRead {
  const tokens: string[] = [];
  let unreadable = false;
  /** リテラルを抜いた残り。ここに残る識別子が「読めない部分」の候補になる。 */
  let residue = "";

  for (let i = 0; i < expression.length; i += 1) {
    const char = expression[i];

    // 行コメント / ブロックコメント。
    if (char === "/" && expression[i + 1] === "/") {
      const end = expression.indexOf("\n", i);
      i = end < 0 ? expression.length : end;
      continue;
    }
    if (char === "/" && expression[i + 1] === "*") {
      const end = expression.indexOf("*/", i + 2);
      i = end < 0 ? expression.length : end + 1;
      continue;
    }

    if (char === '"' || char === "'") {
      let end = i + 1;
      for (; end < expression.length; end += 1) {
        if (expression[end] === char && expression[end - 1] !== "\\") break;
      }
      tokens.push(...expression.slice(i + 1, end).split(/\s+/).filter(Boolean));
      residue += " ";
      i = end;
      continue;
    }

    if (char === "`") {
      let end = i + 1;
      let chunk = "";
      /** 静的部分は `${}` の手前で確定させる。出現順を崩さないため。 */
      const flush = () => {
        tokens.push(...chunk.split(/\s+/).filter(Boolean));
        chunk = "";
      };
      for (; end < expression.length; end += 1) {
        if (expression[end] === "`" && expression[end - 1] !== "\\") break;
        // `${...}` は中身を再帰的に読む。読めなければ unreadable が伝播する。
        if (expression[end] === "$" && expression[end + 1] === "{") {
          flush();
          let depth = 0;
          let close = end + 1;
          for (; close < expression.length; close += 1) {
            if (expression[close] === "{") depth += 1;
            else if (expression[close] === "}") {
              depth -= 1;
              if (depth === 0) break;
            }
          }
          const inner = readClassExpression(expression.slice(end + 2, close));
          tokens.push(...inner.tokens);
          unreadable ||= inner.unreadable;
          end = close;
          continue;
        }
        chunk += expression[end];
      }
      flush();
      residue += " ";
      i = end;
      continue;
    }

    residue += char;
  }

  for (const match of residue.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/g)) {
    if (LITERAL_KEYWORDS.has(match[0])) continue;

    const after = residue.slice(match.index + match[0].length).trimStart();
    // 関数名 (`cn(...)`)。呼び出し自体はクラスを持たない。
    if (after.startsWith("(")) continue;
    // 条件 (`isActive && "x"` / `editing ? ... : ...`)。値ではなく分岐の判定。
    if (after.startsWith("&&") || after.startsWith("||")) continue;
    // `?.` は optional chaining なので条件ではない。
    if (after.startsWith("?") && !after.startsWith("?.")) continue;
    // メンバ参照の途中。末尾のセグメントで判定する。
    if (after.startsWith(".") || after.startsWith("?.")) continue;

    unreadable = true;
  }

  return { tokens: [...new Set(tokens)], unreadable };
}

export type ClassAttributeRead = {
  /** 検査対象のクラス。式なら取り出せたリテラルの合併。 */
  tokens: string[];
  form: "absent" | "literal" | "expression";
  /** クラスを供給しうるのに中身を読めない部分があるか。 */
  unreadable: boolean;
};

/** 開始タグの `className` を、リテラル・式のどちらで書かれていても読む。 */
export function readClassAttribute(tag: string): ClassAttributeRead {
  const literal = readStringAttribute(tag, "className");
  if (literal !== undefined) {
    return {
      tokens: literal.split(/\s+/).filter(Boolean),
      form: "literal",
      unreadable: false,
    };
  }

  const expression = readExpressionAttribute(tag, "className");
  if (expression !== undefined) {
    const read = readClassExpression(expression);
    return { tokens: read.tokens, form: "expression", unreadable: read.unreadable };
  }

  return { tokens: [], form: "absent", unreadable: false };
}
