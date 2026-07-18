/**
 * makeStoreRepo(...).findAreaSearchCandidates SQL-condition tests (M4 / Issue #129).
 * The where() argument is captured and compiled with Drizzle's PostgreSQL
 * dialect so regressions in columns, operators, grouping, and parameters fail.
 */

import { describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

vi.mock("@/lib/db/client", () => ({ db: {} }));

import { makeStoreRepo } from "../store-repository";
import type { DbClient } from "@/lib/db/client";

type Row = Record<string, unknown>;

function makeSelectExecutor(rows: Row[]) {
  let capturedWhere: SQL | undefined;
  const resolved = Promise.resolve(rows);
  const chain: unknown = new Proxy(resolved, {
    get(target, prop) {
      if (prop === "then" || prop === "catch" || prop === "finally") {
        const fn = (target as unknown as Record<string, unknown>)[prop as string];
        return typeof fn === "function" ? fn.bind(target) : undefined;
      }
      if (prop === "where") {
        return (condition: SQL) => {
          capturedWhere = condition;
          return chain;
        };
      }
      return () => chain;
    },
  });
  const select = vi.fn().mockReturnValue(chain);
  return {
    select,
    executor: { select } as unknown as DbClient,
    compiledWhere() {
      expect(capturedWhere).toBeDefined();
      return new PgDialect().sqlToQuery(capturedWhere!);
    },
  };
}

function normalizedSql(sql: string) {
  return sql.replace(/\s+/g, " ").toLowerCase();
}

describe("findAreaSearchCandidates", () => {
  it.each([
    { googlePlaceIds: [] as string[] },
    { googlePlaceIds: [] as string[], bounds: undefined },
  ])("returns [] without DB access when no conditions exist", async (params) => {
    const mock = makeSelectExecutor([]);
    const repo = makeStoreRepo(mock.executor);

    await expect(repo.findAreaSearchCandidates(params)).resolves.toEqual([]);
    expect(mock.select).not.toHaveBeenCalled();
  });

  it("compiles an ID-only google_place_id IN condition", async () => {
    const mock = makeSelectExecutor([]);
    const repo = makeStoreRepo(mock.executor);

    await repo.findAreaSearchCandidates({ googlePlaceIds: ["ChIJ_A", "ChIJ_B"] });

    const query = mock.compiledWhere();
    const sql = normalizedSql(query.sql);
    expect(sql).toContain('"stores"."google_place_id" in ($1, $2)');
    expect(sql).not.toContain('"stores"."lat"');
    expect(query.params).toEqual(["ChIJ_A", "ChIJ_B"]);
  });

  it("compiles bbox-only lat/lng bounds without a google_place_id null guard", async () => {
    const mock = makeSelectExecutor([]);
    const repo = makeStoreRepo(mock.executor);

    await repo.findAreaSearchCandidates({
      googlePlaceIds: [],
      bounds: { minLat: 35, maxLat: 36, minLng: 139, maxLng: 140 },
    });

    const query = mock.compiledWhere();
    const sql = normalizedSql(query.sql);
    expect(sql).toContain('"stores"."lat" >= $1');
    expect(sql).toContain('"stores"."lat" <= $2');
    expect(sql).toContain('"stores"."lng" >= $3');
    expect(sql).toContain('"stores"."lng" <= $4');
    expect(sql).not.toContain("google_place_id");
    expect(sql).not.toContain("is null");
    expect(query.params).toEqual([35, 36, 139, 140]);
  });

  it("OR-combines exact IDs and bbox for null or non-null stale Place IDs", async () => {
    const mock = makeSelectExecutor([]);
    const repo = makeStoreRepo(mock.executor);

    await repo.findAreaSearchCandidates({
      googlePlaceIds: ["ChIJ_NEW"],
      bounds: { minLat: 35, maxLat: 36, minLng: 139, maxLng: 140 },
    });

    const query = mock.compiledWhere();
    const sql = normalizedSql(query.sql);
    expect(sql).toContain('"stores"."google_place_id" in ($1)');
    expect(sql).toContain(" or ");
    expect(sql).toContain('"stores"."lat" >= $2');
    expect(sql).toContain('"stores"."lat" <= $3');
    expect(sql).toContain('"stores"."lng" >= $4');
    expect(sql).toContain('"stores"."lng" <= $5');
    expect(sql).not.toContain("is null");
    expect(query.params).toEqual(["ChIJ_NEW", 35, 36, 139, 140]);
    expect(mock.select).toHaveBeenCalledTimes(1);
  });

  it("uses one SELECT, so a row matching both ID and bbox cannot be duplicated by query union", async () => {
    const row = { id: "store_same" };
    const mock = makeSelectExecutor([row]);
    const repo = makeStoreRepo(mock.executor);

    await repo.findAreaSearchCandidates({
      googlePlaceIds: ["ChIJ_A"],
      bounds: { minLat: 35, maxLat: 36, minLng: 139, maxLng: 140 },
    });

    expect(mock.select).toHaveBeenCalledTimes(1);
    expect(normalizedSql(mock.compiledWhere().sql)).toContain(" or ");
  });
});
