/**
 * makePlaceCandidateRepo のユニットテスト
 * (エリア検索 候補DB保存の土台 / Issue #129 follow-up)
 *
 * テスト方針:
 * - `@/lib/db/client` をモックして実 DB 接続を防ぐ
 * - select は Proxy-based mock (`makeQueryProxy`) で既存レコードを返す
 * - insert / update は `.values(...)` / `.set(...)` の引数を直接キャプチャする
 *   軽量モックに置き換え、保存内容を検証する
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/client", () => ({
  db: {},
}));

import { makePlaceCandidateRepo } from "../place-candidate-repository";
import { createDiscoveryInfo } from "@/lib/places/discovery";
import type { AreaSearchPlaceViewModel, SearchCenter } from "@/lib/places/types";
import type { PlaceCandidate } from "@/types/place-candidate";
import type { DbClient } from "@/lib/db/client";

// ---------------------------------------------------------------------------
// Proxy-based mock executor (select用。prompt-template-repository.test.ts と同様)
// ---------------------------------------------------------------------------

function makeSelectProxy(terminal: unknown[]): object {
  const handler: ProxyHandler<object> = {
    get(_target, prop: string | symbol) {
      if (prop === "then") {
        return (
          onFulfilled: (v: unknown[]) => unknown,
          onRejected?: (e: unknown) => unknown,
        ) => Promise.resolve(terminal).then(onFulfilled, onRejected);
      }
      return () => new Proxy({}, handler);
    },
  };
  return new Proxy({}, handler);
}

/**
 * insert(...).values(captured) / update(...).set(captured).where(...) の
 * 引数をキャプチャするモックを作成する。
 */
function makeWriteCapture() {
  const inserted: Record<string, unknown>[] = [];
  const updated: Record<string, unknown>[] = [];

  const insert = vi.fn(() => ({
    values: (values: Record<string, unknown>) => {
      inserted.push(values);
      return Promise.resolve([]);
    },
  }));

  const update = vi.fn(() => ({
    set: (set: Record<string, unknown>) => {
      updated.push(set);
      return { where: () => Promise.resolve([]) };
    },
  }));

  return { insert, update, inserted, updated };
}

function makeMockExecutor(selectRows: unknown[] = []) {
  const { insert, update, inserted, updated } = makeWriteCapture();
  return {
    select: vi.fn().mockReturnValue(makeSelectProxy(selectRows)),
    insert,
    update,
    delete: vi.fn(),
    inserted,
    updated,
  };
}

// ---------------------------------------------------------------------------
// テストデータ
// ---------------------------------------------------------------------------

const CENTER: SearchCenter = { lat: 35.658, lng: 139.7016 };

function makePlaceViewModel(
  overrides: Partial<AreaSearchPlaceViewModel> = {},
): AreaSearchPlaceViewModel {
  return {
    place: {
      placeId: "ChIJtarget",
      name: "テスト居酒屋",
      formattedAddress: "東京都渋谷区テスト1-1-1",
      lat: 35.6595,
      lng: 139.7005,
      phone: "",
      rating: null,
      userRatingsTotal: null,
      types: ["restaurant", "food"],
      googleMapsUri: null,
    },
    matchedStore: null,
    distanceMeters: 100,
    isWithinRadius: true,
    discovery: createDiscoveryInfo("mainTextSearch"),
    ...overrides,
  };
}

function makeExistingRow(overrides: Partial<PlaceCandidate> = {}): PlaceCandidate {
  return {
    id: "place_candidate_existing",
    google_place_id: "ChIJtarget",
    status: "candidate",
    first_seen_at: "2026-06-01",
    last_seen_at: "2026-06-01",
    seen_count: 1,
    discovery_sources: ["mainTextSearch"],
    last_searched_keyword: "居酒屋",
    last_searched_area: "渋谷駅",
    last_center_lat: CENTER.lat,
    last_center_lng: CENTER.lng,
    last_radius_meters: 1000,
    last_distance_meters: 100,
    last_is_within_radius: true,
    matched_store_id: null,
    created_at: "2026-06-01",
    updated_at: "2026-06-01",
    ...overrides,
  };
}

const baseParams = {
  keyword: "居酒屋",
  area: "渋谷駅",
  center: CENTER,
  radiusMeters: 1000,
};

describe("makePlaceCandidateRepo.upsertFromAreaSearch", () => {
  let executor: ReturnType<typeof makeMockExecutor>;

  beforeEach(() => {
    executor = makeMockExecutor();
  });

  it("新しいplaceIdはinsertされる", async () => {
    executor = makeMockExecutor([]); // 既存レコードなし
    const repo = makePlaceCandidateRepo(executor as unknown as DbClient);

    const result = await repo.upsertFromAreaSearch({
      ...baseParams,
      places: [makePlaceViewModel()],
    });

    expect(result.insertedCount).toBe(1);
    expect(result.updatedCount).toBe(0);
    expect(result.skippedCount).toBe(0);
    expect(executor.inserted).toHaveLength(1);
    expect(executor.inserted[0]!.google_place_id).toBe("ChIJtarget");
    expect(executor.updated).toHaveLength(0);
  });

  it("既存placeIdはupdateされる", async () => {
    executor = makeMockExecutor([makeExistingRow()]);
    const repo = makePlaceCandidateRepo(executor as unknown as DbClient);

    const result = await repo.upsertFromAreaSearch({
      ...baseParams,
      places: [makePlaceViewModel()],
    });

    expect(result.updatedCount).toBe(1);
    expect(result.insertedCount).toBe(0);
    expect(executor.updated).toHaveLength(1);
    expect(executor.inserted).toHaveLength(0);
  });

  it("firstSeenAtは維持される (insertのみで設定され、update時はsetに含まれない)", async () => {
    const existing = makeExistingRow({ first_seen_at: "2026-05-01" });
    executor = makeMockExecutor([existing]);
    const repo = makePlaceCandidateRepo(executor as unknown as DbClient);

    await repo.upsertFromAreaSearch({
      ...baseParams,
      places: [makePlaceViewModel({ discovery: createDiscoveryInfo("loadMore") })],
    });

    expect(executor.updated[0]).not.toHaveProperty("first_seen_at");
  });

  it("lastSeenAtは更新される", async () => {
    const existing = makeExistingRow({ last_seen_at: "2026-05-01" });
    executor = makeMockExecutor([existing]);
    const repo = makePlaceCandidateRepo(executor as unknown as DbClient);

    await repo.upsertFromAreaSearch({
      ...baseParams,
      places: [makePlaceViewModel()],
    });

    expect(executor.updated[0]!.last_seen_at).not.toBe("2026-05-01");
  });

  it("seenCountが増える", async () => {
    const existing = makeExistingRow({ seen_count: 3 });
    executor = makeMockExecutor([existing]);
    const repo = makePlaceCandidateRepo(executor as unknown as DbClient);

    await repo.upsertFromAreaSearch({
      ...baseParams,
      places: [makePlaceViewModel()],
    });

    expect(executor.updated[0]!.seen_count).toBe(4);
  });

  it("discoverySourcesが統合される", async () => {
    const existing = makeExistingRow({ discovery_sources: ["mainTextSearch"] });
    executor = makeMockExecutor([existing]);
    const repo = makePlaceCandidateRepo(executor as unknown as DbClient);

    await repo.upsertFromAreaSearch({
      ...baseParams,
      places: [makePlaceViewModel({ discovery: createDiscoveryInfo("loadMore") })],
    });

    expect(executor.updated[0]!.discovery_sources).toEqual(["mainTextSearch", "loadMore"]);
  });

  it("duplicate sourceは増えない", async () => {
    const existing = makeExistingRow({ discovery_sources: ["mainTextSearch"] });
    executor = makeMockExecutor([existing]);
    const repo = makePlaceCandidateRepo(executor as unknown as DbClient);

    await repo.upsertFromAreaSearch({
      ...baseParams,
      places: [makePlaceViewModel({ discovery: createDiscoveryInfo("mainTextSearch") })],
    });

    expect(executor.updated[0]!.discovery_sources).toEqual(["mainTextSearch"]);
  });

  it("added/ignored statusをcandidateに戻さない", async () => {
    const existingAdded = makeExistingRow({ status: "added" });
    executor = makeMockExecutor([existingAdded]);
    const repo = makePlaceCandidateRepo(executor as unknown as DbClient);

    await repo.upsertFromAreaSearch({
      ...baseParams,
      places: [makePlaceViewModel()],
    });

    expect(executor.updated[0]!.status).toBe("added");
  });

  it("placeIdが空の候補はskip", async () => {
    executor = makeMockExecutor([]);
    const repo = makePlaceCandidateRepo(executor as unknown as DbClient);

    const result = await repo.upsertFromAreaSearch({
      ...baseParams,
      places: [
        makePlaceViewModel({
          place: {
            placeId: "",
            name: "placeId無し",
            formattedAddress: "",
            lat: 0,
            lng: 0,
            phone: "",
            rating: null,
            userRatingsTotal: null,
            types: [],
            googleMapsUri: null,
          },
        }),
      ],
    });

    expect(result.skippedCount).toBe(1);
    expect(result.insertedCount).toBe(0);
    expect(result.updatedCount).toBe(0);
    expect(executor.select).not.toHaveBeenCalled();
    expect(executor.inserted).toHaveLength(0);
  });
});
