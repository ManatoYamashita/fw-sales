/**
 * DB を書き換える Server Action の呼び出しが、すべて `runAction` を通ることを固定する (#327)。
 *
 * `runAction` を通らない呼び出しは、成功トーストの出し忘れと、例外時に画面全体が
 * error.tsx へ差し替わる状態を生む。走査は TypeScript の構文木で行い、
 * コメントや文字列の中の名前には反応しない。
 *
 * - 公開されている Action はすべて「書き込み」か「読み取りのみ」に分類する。
 *   新しい Action を足したら、ここへの追加を強制する (分類漏れで走査対象から黙って外れないため)
 * - 書き込み Action は、`runAction(() => xxxAction(...), …)` の第 1 引数の関数の中でだけ呼ぶ
 */

import { readdirSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/** DB の業務データを書き換える Action。呼び出しは runAction を通す。 */
const WRITE_ACTIONS = new Set([
  "recordActionAction",
  "addStoreFromPlaceAction",
  "bulkAddStoresFromPlacesAction",
  "updateBasicInfoFieldAction",
  "resetToSeedAction",
  "clearAllAction",
  "importJsonAction",
  "createDealAction",
  "updateDealAction",
  "deleteDealAction",
  "deleteSalesActivityAction",
  "createHandoffAction",
  "updateHandoffAction",
  "completeHandoffAction",
  "deleteHandoffAction",
  "markNotificationReadAction",
  "markAllNotificationsReadAction",
  "updateProfileRoleAction",
  "createPromptTemplateAction",
  "updatePromptTemplateAction",
  "deletePromptTemplateAction",
  "setDefaultPromptTemplateAction",
  "startResearchRunAction",
  "recordReviewDecisionAction",
  "adoptBulkLaneAction",
  "completeReviewAction",
  "generateSalesAssetsAction",
  "createStoreAction",
  "createStoreAndRedirect",
  "updateStoreAction",
  "updateStoreStageAction",
  "updateStorePatchAction",
  "updateSalesProgressAction",
  "deleteStoreAction",
  "bulkDeleteStoresAction",
]);

/** 業務データを書き換えない Action と、その理由。 */
const NON_WRITE_ACTIONS: Record<string, string> = {
  searchPlacesWithMatchesAction: "Places API の検索結果を返すだけ",
  getPlaceDetailsForAreaSearchAction: "Places API の詳細を返すだけ",
  searchPlacesAction: "Places API の検索結果を返すだけ",
  getSessionRoleAction: "ログイン中のロールを返すだけ",
  signOutAction: "認証セッションを破棄するだけで、業務データを書き換えない",
  getSnapshotForExportAction: "書き出し用に読むだけ",
  listPromptTemplatesAction: "一覧を読むだけ",
  getResearchRunStatusAction: "調査の進み具合を読むだけ",
  getStoreDeleteImpactAction: "削除の影響件数を数えるだけ",
  importFromUrlAction: "URL を解析して入力候補を返すだけ (保存はフォーム送信時の createStoreAction)",
};

function parse(source: string, fileName = "x.tsx"): ts.SourceFile {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function exportedActions(): string[] {
  return readdirSync("lib/actions")
    .filter((f) => /^[a-z].*\.ts$/.test(f))
    .flatMap((f) =>
      parse(readFileSync(`lib/actions/${f}`, "utf8"), f)
        .statements.filter(
          (s): s is ts.FunctionDeclaration =>
            ts.isFunctionDeclaration(s) &&
            !!s.name &&
            !!s.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword),
        )
        .map((s) => s.name!.text),
    );
}

/** `runAction(() => …)` の第 1 引数の関数の中にいるか。 */
function insideRunAction(node: ts.Node): boolean {
  for (let cur: ts.Node | undefined = node; cur; cur = cur.parent) {
    const parent: ts.Node | undefined = cur.parent;
    if (
      parent &&
      ts.isCallExpression(parent) &&
      parent.expression.getText() === "runAction" &&
      parent.arguments[0] === cur &&
      (ts.isArrowFunction(cur) || ts.isFunctionExpression(cur))
    ) {
      return true;
    }
  }
  return false;
}

/**
 * 書き込み Action を runAction の外で使っている箇所を返す。
 * 呼び出しに限らず、props へ渡す・`<form action={…}>` に置くといった参照も外とみなす。
 */
export function uncoveredWriteActionUses(source: string, fileName = "x.tsx"): string[] {
  const sf = parse(source, fileName);
  // このファイルで lib/actions から import した書き込み Action のローカル名
  const locals = new Map<string, string>();
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const from = (statement.moduleSpecifier as ts.StringLiteral).text;
    if (!from.startsWith("@/lib/actions/")) continue;
    const named = statement.importClause?.namedBindings;
    if (!named || !ts.isNamedImports(named)) continue;
    for (const el of named.elements) {
      const imported = (el.propertyName ?? el.name).text;
      if (WRITE_ACTIONS.has(imported)) locals.set(el.name.text, imported);
    }
  }
  if (locals.size === 0) return [];

  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isIdentifier(node) &&
      locals.has(node.text) &&
      !ts.isImportSpecifier(node.parent) &&
      !insideRunAction(node)
    ) {
      const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
      out.push(`${fileName}:${line} ${locals.get(node.text)}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

describe("Action の分類", () => {
  const actions = exportedActions();

  it("公開されている Action を取得できている (空振りしていない)", () => {
    expect(actions.length).toBeGreaterThan(30);
  });

  it("すべての Action が書き込みか読み取りのみに分類されている", () => {
    const unclassified = actions.filter(
      (name) => !WRITE_ACTIONS.has(name) && !(name in NON_WRITE_ACTIONS),
    );
    expect(unclassified).toEqual([]);
  });

  it("分類表に、もう存在しない Action が残っていない", () => {
    const stale = [...WRITE_ACTIONS, ...Object.keys(NON_WRITE_ACTIONS)].filter(
      (name) => !actions.includes(name),
    );
    expect(stale).toEqual([]);
  });
});

describe("uncoveredWriteActionUses の検知力", () => {
  it("#327 以前の店舗削除 (原文) を検出する", () => {
    const before = `
import { deleteStoreAction } from "@/lib/actions/store-actions";
const remove = () => {
  startTransition(async () => {
    const result = await deleteStoreAction(storeId);
    if (result && !result.ok) {
      toast.error(result.error);
    }
  });
};`;
    expect(uncoveredWriteActionUses(before)).toEqual(["x.tsx:5 deleteStoreAction"]);
  });

  it("別名で import しても検出する", () => {
    const source = `
import { deleteStoreAction as remove } from "@/lib/actions/store-actions";
await remove(id);`;
    expect(uncoveredWriteActionUses(source)).toHaveLength(1);
  });

  it("props や form の action へ渡す参照も検出する", () => {
    const source = `
import { createStoreAction } from "@/lib/actions/store-actions";
const el = <form action={createStoreAction} />;`;
    expect(uncoveredWriteActionUses(source)).toHaveLength(1);
  });

  it("runAction の第 1 引数の中なら通す", () => {
    const source = `
import { deleteStoreAction } from "@/lib/actions/store-actions";
await runAction(() => deleteStoreAction(id), { success: "店舗を削除しました" });
await runAction(async () => { return deleteStoreAction(id); }, { success: "x" });`;
    expect(uncoveredWriteActionUses(source)).toEqual([]);
  });

  it("runAction の第 2 引数側に書いても通さない", () => {
    const source = `
import { deleteStoreAction } from "@/lib/actions/store-actions";
await runAction(() => noop(), { success: deleteStoreAction(id) });`;
    expect(uncoveredWriteActionUses(source)).toHaveLength(1);
  });

  it("コメントの中の名前や、読み取りのみの Action には反応しない", () => {
    const source = `
import { getStoreDeleteImpactAction } from "@/lib/actions/store-actions";
// deleteStoreAction は runAction 経由で呼ぶ
await getStoreDeleteImpactAction(ids);`;
    expect(uncoveredWriteActionUses(source)).toEqual([]);
  });
});

describe("リポジトリ全体", () => {
  const files = execSync("git ls-files 'app/**/*.tsx' 'app/**/*.ts' 'components/**/*.tsx' 'components/**/*.ts'", {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter((f) => !f.includes("__tests__"));

  it("書き込み Action を import しているファイルがある (空振りしていない)", () => {
    const importing = files.filter((f) => {
      const s = readFileSync(f, "utf8");
      return [...WRITE_ACTIONS].some((name) => s.includes(name));
    });
    expect(importing.length).toBeGreaterThan(20);
  });

  it("書き込み Action はすべて runAction を通して呼ぶ", () => {
    const uses = files.flatMap((f) => uncoveredWriteActionUses(readFileSync(f, "utf8"), f));
    expect(uses).toEqual([]);
  });
});
