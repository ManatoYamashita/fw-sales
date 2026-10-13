/**
 * Turbopack のビルド用キャッシュを切ったままにしておくことを固定する。
 *
 * Next.js 16.3 から既定で有効になったこのキャッシュは、Vercel がビルド間で引き継ぐ
 * .next/cache から読まれる。app/globals.css の変更を拾わず、#326 で足した規則 5 つ
 * (進行バー・ボタンのスピナー) だけが本番の CSS から抜けた。Tailwind のクラスは新しい
 * のに globals.css の追記分だけ古い、という気づきにくい壊れ方をする。
 *
 * 再現手順 (手元): `.next` を消して旧 main でビルド → `.next` を残したまま新しい
 * main でビルド → 成果物の CSS から globals.css の追記が消える。設定を false にすると、
 * 同じ手順でもキャッシュの無いビルドと同一の CSS になる。
 */

import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/** `experimental.turbopackFileSystemCacheForBuild` に書かれた値 (無ければ undefined)。 */
export function buildCacheSetting(source: string): string | undefined {
  const sf = ts.createSourceFile("next.config.ts", source, ts.ScriptTarget.Latest, true);
  let value: string | undefined;
  const visit = (node: ts.Node) => {
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText(sf) === "turbopackFileSystemCacheForBuild" &&
      ts.isObjectLiteralExpression(node.parent) &&
      ts.isPropertyAssignment(node.parent.parent) &&
      node.parent.parent.name.getText(sf) === "experimental"
    ) {
      value = node.initializer.getText(sf);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return value;
}

describe("buildCacheSetting の検知力", () => {
  it("書かれていない (既定の true のまま) ことを検出できる", () => {
    expect(buildCacheSetting(`const c = { cacheComponents: true };`)).toBeUndefined();
  });

  it("true に戻したことを検出できる", () => {
    const source = `const c = { experimental: { turbopackFileSystemCacheForBuild: true } };`;
    expect(buildCacheSetting(source)).toBe("true");
  });

  it("experimental の外に書いた (効かない) ものは数えない", () => {
    const source = `const c = { turbopackFileSystemCacheForBuild: false };`;
    expect(buildCacheSetting(source)).toBeUndefined();
  });

  it("コメントで触れただけでは数えない", () => {
    const source = `// turbopackFileSystemCacheForBuild: false\nconst c = { experimental: {} };`;
    expect(buildCacheSetting(source)).toBeUndefined();
  });
});

describe("next.config.ts", () => {
  it("Turbopack のビルド用キャッシュを切っている", () => {
    expect(buildCacheSetting(readFileSync("next.config.ts", "utf8"))).toBe("false");
  });
});
