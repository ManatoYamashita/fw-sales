/**
 * makeStoreRepo(...).findAreaSearchCandidates unit tests (M4 / Issue #129).
 *
 * Test strategy (same pattern as store-repository.delete-impact.test.ts):
 * - Mock @/lib/db/client to prevent real DB connections.
 * - Use a Proxy-based mock that lets the drizzle query-builder chain resolve
 *   to a predetermined rows array, without wiring every chain method by hand.
 * - Verify early-return behaviour and that the DB is actually called otherwise.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/client", () => ({
  db: {},
}));

import { makeStoreRepo } from "../store-repository";
import type { DbClient } from "@/lib/db/client";

type Row = Record<string, unknown>;

/**
 * Returns a mock executor whose `select()` starts a drizzle-like chain.
 * Any method on the chain (from, where, orderBy, …) returns the same proxy,
 * which resolves to `rows` when awaited.
 */
function makeSelectExecutor(rows: Row[]) {
  const resolved = Promise.resolve(rows);
  // Proxy delegates .then/.catch/.finally to the promise; all other props
  // return a function that returns the proxy itself (chaining support).
  const chain: unknown = new Proxy(resolved, {
    get(target, prop) {
      if (prop === "then" || prop === "catch" || prop === "finally") {
        const fn = (target as unknown as Record<string, unknown>)[prop as string];
        return typeof fn === "function" ? fn.bind(target) : undefined;
      }
      return () => chain;
    },
  });
  const select = vi.fn().mockReturnValue(chain);
  return { select, executor: { select } as unknown as DbClient };
}

/** Minimal valid store row with all NOT NULL columns satisfied. */
function makeStoreRow(overrides: Partial<Row> = {}): Row {
  return {
    id: "store_test_001",
    name: "Test Store",
    prefecture: "Tokyo",
    city: "Shibuya",
    address: "1-1-1",
    genre: "restaurant",
    priority: "中",
    stage: "未調査",
    channel: "未判定",
    has_contact_form: "未確認",
    map_url: "",
    site_url: "",
    instagram_url: "",
    phone: "",
    target_service: "",
    review_count: 0,
    review_avg: 0,
    memo: "",
    assigned_planner_user_id: null,
    assigned_sales_user_id: null,
    operator_type: "未設定",
    operator_name: "",
    ai_analysis_result: null,
    lat: 35.6762,
    lng: 139.6503,
    google_place_id: "ChIJ_001",
    basic_info: {},
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    ...overrides,
  };
}

describe("findAreaSearchCandidates", () => {
  it("returns [] without calling DB when googlePlaceIds is empty and bounds is undefined", async () => {
    const { select, executor } = makeSelectExecutor([]);
    const repo = makeStoreRepo(executor);

    const result = await repo.findAreaSearchCandidates({ googlePlaceIds: [] });
    expect(result).toEqual([]);
    expect(select).not.toHaveBeenCalled();
  });

  it("returns [] without calling DB when googlePlaceIds is empty and bounds is undefined (explicit)", async () => {
    const { select, executor } = makeSelectExecutor([]);
    const repo = makeStoreRepo(executor);

    const result = await repo.findAreaSearchCandidates({
      googlePlaceIds: [],
      bounds: undefined,
    });
    expect(result).toEqual([]);
    expect(select).not.toHaveBeenCalled();
  });

  it("calls DB and maps rows to Store[] when googlePlaceIds is non-empty", async () => {
    const row = makeStoreRow({ google_place_id: "ChIJ_001" });
    const { select, executor } = makeSelectExecutor([row]);
    const repo = makeStoreRepo(executor);

    const result = await repo.findAreaSearchCandidates({
      googlePlaceIds: ["ChIJ_001"],
    });
    expect(select).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("store_test_001");
  });

  it("calls DB when only bounds is provided (no googlePlaceIds)", async () => {
    const row = makeStoreRow({ google_place_id: null });
    const { select, executor } = makeSelectExecutor([row]);
    const repo = makeStoreRepo(executor);

    const result = await repo.findAreaSearchCandidates({
      googlePlaceIds: [],
      bounds: { minLat: 35.0, maxLat: 36.0, minLng: 139.0, maxLng: 140.0 },
    });
    expect(select).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
  });

  it("calls DB when both googlePlaceIds and bounds are provided", async () => {
    const rows = [
      makeStoreRow({ google_place_id: "ChIJ_001" }),
      makeStoreRow({ id: "store_002", google_place_id: null, lat: 35.5, lng: 139.5 }),
    ];
    const { select, executor } = makeSelectExecutor(rows);
    const repo = makeStoreRepo(executor);

    const result = await repo.findAreaSearchCandidates({
      googlePlaceIds: ["ChIJ_001"],
      bounds: { minLat: 35.0, maxLat: 36.0, minLng: 139.0, maxLng: 140.0 },
    });
    expect(select).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(2);
  });

  it("returns empty array when DB returns no rows", async () => {
    const { executor } = makeSelectExecutor([]);
    const repo = makeStoreRepo(executor);

    const result = await repo.findAreaSearchCandidates({
      googlePlaceIds: ["ChIJ_no_match"],
    });
    expect(result).toEqual([]);
  });
});
