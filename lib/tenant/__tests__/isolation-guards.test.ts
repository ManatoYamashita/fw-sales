import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as schema from "@/lib/db/schema";
import { CACHE_TAGS } from "@/lib/cache";
import { unsafeCacheTagCalls } from "@/lib/tenant/cache-tag-guard";
import type { Repos, TxRepos } from "@/lib/repositories";
import type { makeStoreRepo } from "@/lib/db/store-repository";

type Assert<T extends true> = T;
// 未束縛入口が復活したら typecheck が落ちる。
type NoUnboundStore = Assert<"store" extends keyof Repos ? false : true>;
type NoUnboundCandidates = Assert<"placeCandidate" extends keyof Repos ? false : true>;
type NoUnboundTxStore = Assert<"store" extends keyof TxRepos ? false : true>;
type FactoryRequiresTenant = Assert<Parameters<typeof makeStoreRepo> extends [unknown, string] ? true : false>;
export type TenantTypeGuards = [NoUnboundStore, NoUnboundCandidates, NoUnboundTxStore, FactoryRequiresTenant];

function source(file: string, text = readFileSync(file, "utf8")) {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? (entry.name === "__tests__" ? [] : files(file)) : /\.tsx?$/.test(file) ? [file] : [];
  });
}

describe("テナント分離の静的ガード (#369 骨格)", () => {
  it("共有テーブル以外の全テーブルが tenant_id NOT NULL を持つ", () => {
    const tables = (Object.values(schema) as unknown[]).filter((value): value is PgTable => value instanceof PgTable);
    expect(tables.length).toBeGreaterThan(3);
    for (const table of tables) {
      const config = getTableConfig(table);
      if (["tenants", "profiles", "memberships"].includes(config.name)) continue;
      expect(config.columns.find((column) => column.name === "tenant_id")?.notNull, config.name).toBe(true);
    }
  });
  it("全タグがテナントを必須とし、同じ ID でも別テナントとは一致しない", () => {
    for (const makeTag of Object.values(CACHE_TAGS)) {
      expect(makeTag.length).toBeGreaterThan(0);
      expect(makeTag("tenant-a", "same-id")).not.toBe(makeTag("tenant-b", "same-id"));
    }
  });
  it("アプリのタグが CACHE_TAGS に由来し、キャッシュ関数が tenantId を引数で受け取る", () => {
    const checked = ["lib/actions", "lib/queries", "app", "components", "workflows"].flatMap(files);
    expect(checked.length).toBeGreaterThan(0);
    for (const file of checked) {
      const sf = source(file);
      expect(unsafeCacheTagCalls(sf), file).toEqual([]);
      function walk(node: ts.Node) {
        if (ts.isFunctionDeclaration(node) && node.body?.statements.some((statement) => ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression) && statement.expression.text === "use cache")) {
          expect(node.parameters.some((param) => param.name.getText(sf) === "tenantId"), `${file}:${node.name?.text}`).toBe(true);
          expect(node.body.getText(sf), file).not.toContain("resolveTenantId(");
        }
        ts.forEachChild(node, walk);
      }
      walk(sf);
    }
  });
  it.each([
    'cacheTag("stores")',
    'revalidateTag("store:" + id, "max")',
    'updateTag(`store:${id}`)',
    'const tag = "stores"; updateTag(tag)',
    'const tag = CACHE_TAGS.stores(); updateTag(tag)',
    'let tag = CACHE_TAGS.stores(tenantId); tag = "stores"; updateTag(tag)',
  ])("反証を拒否する %s", (code) => {
    expect(unsafeCacheTagCalls(source("fixture.ts", 'import { cacheTag, revalidateTag, updateTag } from "next/cache"; ' + code))).toHaveLength(1);
  });
  it("const、配列の for-of、別名 import を検査する", () => {
    const sf = source("fixture.ts", `import { updateTag as expire } from "next/cache";
      const tag = CACHE_TAGS.stores(tenantId); expire(tag);
      for (const item of [CACHE_TAGS.stores(tenantId), CACHE_TAGS.deals(tenantId)]) expire(item);
      { const tag = "stores"; expire(tag); }`);
    expect(unsafeCacheTagCalls(sf)).toHaveLength(1);
  });
});
