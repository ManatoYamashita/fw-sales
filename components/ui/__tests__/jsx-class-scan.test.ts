/**
 * `className` の読み取り (#262) の分岐を直接固定する。
 *
 * `class-conflicts.test.ts` はリポジトリ全体を走査して「衝突が 0 件であること」を見るので、
 * **読み取りが壊れても緑になる**（読めなければ衝突も出ない）。読み取り自体の検知力は
 * ここで別に立証する。`docs/architecture/responsive.md` §5「空振り検証を必ず添える」。
 *
 * 事故の原文をそのまま置いてあるケースは、**それが落ちなかったのが #262 の中身**である。
 */

import { describe, expect, it } from "vitest";
import {
  openingTags,
  readClassAttribute,
  readClassExpression,
  readExpressionAttribute,
  readStringAttribute,
} from "./support/jsx-class-scan";

describe("openingTags", () => {
  it("前方一致の別コンポーネントを拾わない", () => {
    expect(openingTags("<ButtonGroup />", "Button")).toEqual([]);
    expect(openingTags("<Button />", "Button")).toHaveLength(1);
  });

  it("属性内のアロー関数の > でタグを切らない", () => {
    const source = `<Select onChange={(e) => setX(e.target.value)} className="w-32" />`;
    const tags = openingTags(source, "Select");
    expect(tags).toHaveLength(1);
    expect(tags[0]?.text).toContain(`className="w-32"`);
  });

  it("複数行のタグを 1 つとして切り出す", () => {
    const source = ['<Spinner', '  className="h-3 w-3"', "/>"].join("\n");
    expect(openingTags(source, "Spinner")).toHaveLength(1);
  });

  it("ドットを含む名前を扱える", () => {
    expect(openingTags(`<Card.Body className="p-0" />`, "Card.Body")).toHaveLength(1);
  });
});

describe("readStringAttribute", () => {
  it("二重引用符と単一引用符のどちらでも読む", () => {
    expect(readStringAttribute(`<Button size="sm" />`, "size")).toBe("sm");
    // 単一引用符は #262 以前は読めず、size 未指定 (= 既定値) として扱われていた。
    expect(readStringAttribute(`<Button size='sm' />`, "size")).toBe("sm");
  });

  it("式で書かれていれば undefined", () => {
    expect(readStringAttribute(`<Button size={x} />`, "size")).toBeUndefined();
  });

  it("空文字を undefined と混同しない", () => {
    expect(readStringAttribute(`<Button className="" />`, "className")).toBe("");
  });
});

describe("readExpressionAttribute", () => {
  it("入れ子の波括弧の対応を取る", () => {
    expect(readExpressionAttribute(`<Button className={cn({ a: b })} />`, "className"))
      .toBe("cn({ a: b })");
  });

  it("文字列の中の波括弧に釣られない", () => {
    expect(readExpressionAttribute(`<Button className={cn("a}b")} />`, "className"))
      .toBe(`cn("a}b")`);
  });
});

describe("readClassExpression", () => {
  it("三項演算子の両側からリテラルを合併する", () => {
    // #248 の原文。
    expect(readClassExpression(`editing ? undefined : "p-0"`)).toEqual({
      tokens: ["p-0"],
      unreadable: false,
    });
    expect(readClassExpression(`editing ? "px-5" : "p-0"`)).toEqual({
      tokens: ["px-5", "p-0"],
      unreadable: false,
    });
  });

  it("cn の引数と && の右辺を拾う", () => {
    expect(readClassExpression(`cn("flex items-start", isActive && "bg-muted")`)).toEqual({
      tokens: ["flex", "items-start", "bg-muted"],
      unreadable: false,
    });
  });

  it("テンプレートリテラルの静的部分を拾い、埋め込みは再帰的に読む", () => {
    expect(readClassExpression("`h-4 w-4 ${big ? \"p-2\" : \"p-1\"}`")).toEqual({
      tokens: ["h-4", "w-4", "p-2", "p-1"],
      unreadable: false,
    });
  });

  it("変数参照は読めない側へ倒す", () => {
    expect(readClassExpression(`className`)).toEqual({ tokens: [], unreadable: true });
    expect(readClassExpression(`cn("mt-2", className)`)).toEqual({
      tokens: ["mt-2"],
      unreadable: true,
    });
    expect(readClassExpression(`styles.root`)).toEqual({ tokens: [], unreadable: true });
    expect(readClassExpression(`map["k"]`)).toEqual({ tokens: ["k"], unreadable: true });
    expect(readClassExpression("`h-4 ${size}`")).toEqual({
      tokens: ["h-4"],
      unreadable: true,
    });
  });

  it("オブジェクトリテラルの条件付きクラスは、引用符の有無によらず読めない側へ倒す", () => {
    // キーは ternary の `cond ? a : b` と、値は「クラスではない条件」と区別できない。
    expect(readClassExpression(`cn({ hidden: isOpen })`)).toEqual({
      tokens: [],
      unreadable: true,
    });
    expect(readClassExpression(`cn({ "hidden": isOpen })`)).toEqual({
      tokens: ["hidden"],
      unreadable: true,
    });
    // clsx で等価な `&&` 形なら読める。
    expect(readClassExpression(`cn(isOpen && "hidden")`)).toEqual({
      tokens: ["hidden"],
      unreadable: false,
    });
  });

  it("optional chaining を条件と取り違えない", () => {
    expect(readClassExpression(`deal?.id`)).toEqual({ tokens: [], unreadable: true });
  });

  it("コメントの中の識別子で読めない判定にしない", () => {
    expect(readClassExpression(`/* someVar */ "p-0"`)).toEqual({
      tokens: ["p-0"],
      unreadable: false,
    });
  });

  it("同じクラスを 2 回書いても 1 つに畳む", () => {
    expect(readClassExpression(`a ? "p-0" : "p-0"`).tokens).toEqual(["p-0"]);
  });
});

describe("readClassAttribute", () => {
  it("リテラル / 式 / 未指定を区別する", () => {
    expect(readClassAttribute(`<Card.Body className="p-0" />`)).toEqual({
      tokens: ["p-0"],
      form: "literal",
      unreadable: false,
    });
    expect(readClassAttribute(`<Card.Body className={editing ? undefined : "p-0"} />`)).toEqual({
      tokens: ["p-0"],
      form: "expression",
      unreadable: false,
    });
    expect(readClassAttribute(`<Card.Body padding="flush" />`)).toEqual({
      tokens: [],
      form: "absent",
      unreadable: false,
    });
  });
});
