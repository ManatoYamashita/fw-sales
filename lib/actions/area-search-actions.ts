"use server";

import { revalidateTag } from "next/cache";
import { repos } from "@/lib/repositories";
import { CACHE_TAGS } from "@/lib/cache";
import {
  searchPlaces,
  searchPlacesPage,
  searchNearbyPlaces,
  getPlaceById,
  getPlaceDetails,
  resolveSearchCenter,
} from "@/lib/places/google";
import { placeResultToStoreInput } from "@/lib/places/to-store-input";
import { placeResultToBasicInfo } from "@/lib/places/to-basic-info";
import { attachStoreMatches } from "@/lib/places/match-store";
import { deduplicatePlaceIds } from "@/lib/places/bulk-utils";
import { createDiscoveryInfo } from "@/lib/places/discovery";
import { attachCandidateInfo } from "@/lib/places/candidate-info";
import { buildTextSearchMeta } from "@/lib/places/search-meta";
import { distanceMeters } from "@/lib/utils/geo";
import type {
  AreaSearchDiscoverySource,
  AreaSearchPlaceViewModel,
  AreaSearchResultPayload,
  PlaceDetailsResult,
  PlaceResult,
  SearchCenter,
} from "@/lib/places/types";
import { success, failure, type ActionResult } from "./_helpers";

/**
 * エリア検索結果を `place_candidates` に保存する (候補DB保存の土台 / Issue #129 follow-up)。
 *
 * 保存に失敗しても検索自体は失敗させない (ログのみ残す)。`candidatePersistence` は
 * 保存できた場合のみ payload に含める。
 */
async function persistAreaSearchCandidates(
  places: AreaSearchPlaceViewModel[],
  keyword: string,
  area: string,
  center: SearchCenter,
  radiusMeters: number,
): Promise<AreaSearchResultPayload["candidatePersistence"]> {
  try {
    return await repos.placeCandidate.upsertFromAreaSearch({
      places,
      keyword,
      area,
      center,
      radiusMeters,
    });
  } catch (e) {
    console.error("[area-search] 候補DB保存に失敗しました", e);
    return undefined;
  }
}

/**
 * `place_candidates` を `google_place_id` (= `place.placeId`) で再取得し、
 * 各 `viewModels` 要素に `candidateInfo` を付与する (候補DB照合 / Issue #129 follow-up)。
 *
 * - 保存 (`persistAreaSearchCandidates`) の後に呼ぶことで、保存直後の最新の
 *   `seenCount`/`lastSeenAt` を反映できる
 * - 保存が失敗した場合でも、既存の候補DBレコードとの照合は試みる
 * - 取得自体に失敗しても検索を失敗させない (ログのみ残し、全件 `candidateInfo: null` のまま返す)
 */
async function attachAreaSearchCandidateInfo(
  viewModels: AreaSearchPlaceViewModel[],
): Promise<AreaSearchPlaceViewModel[]> {
  const placeIds = viewModels.map((vm) => vm.place.placeId).filter((id) => id !== "");
  try {
    const candidates = await repos.placeCandidate.findByGooglePlaceIds(placeIds);
    return attachCandidateInfo(viewModels, candidates);
  } catch (e) {
    console.error("[area-search] 候補DB照合に失敗しました", e);
    return viewModels;
  }
}

/**
 * PlaceResult から 1 店舗を作成し、同 transaction 内で basic_info を充填する
 * (store-basic-info / Issue #114, task 3.1)。
 *
 * - スカラー列 (name, address, genre, phone, review_avg, review_count, lat, lng, google_place_id 等) は
 *   既存 `placeResultToStoreInput` 経由で create 時に投入 (PR1 expand 期は両系統が併存)。
 * - jsonb の `basic_info` は `placeResultToBasicInfo` で primary="places" 項目に変換し、
 *   `mergeBasicInfo` 経由で取得ソース="places" を記録(R3.2)。
 * - create と merge を 1 transaction に閉じ込め、create 成功 → merge 失敗で中途半端な
 *   状態が残ることを防ぐ(原子性)。
 * - PlaceResult から取得できない basic_info 項目は未充足のまま残る(R3.3)。
 *
 * @throws DB エラー時。呼出側で catch して failure に変換すること。
 */
async function createStoreFromPlaceTx(
  place: PlaceResult,
): Promise<{ id: string; name: string }> {
  return repos.transaction(async ({ store }) => {
    const input = placeResultToStoreInput(place);
    const created = await store.create(input);
    const partial = placeResultToBasicInfo(place, new Date().toISOString());
    if (Object.keys(partial).length > 0) {
      await store.mergeBasicInfo(created.id, partial, "places");
    }
    return { id: created.id, name: created.name };
  });
}

export interface SearchPlacesWithMatchesOptions {
  /** 前ページのレスポンスで返された `nextPageToken` (「もっと読み込む」用)。 */
  pageToken?: string;
  /**
   * 初回検索で解決済みの中心地点。「もっと読み込む」時にこれを渡すことで、
   * `centerQuery` の再解決 (=Places API呼び出し) を省略し、初回と同じ
   * `locationBias` を使い回す (pageToken のパラメータ不一致を防ぐ)。
   */
  center?: SearchCenter;
  /**
   * この呼び出しで見つかった店舗に付与する探索ソース。
   * 省略時は `pageToken` の有無から自動判定する
   * (`pageToken` あり = "loadMore"、なし = "mainTextSearch")。
   * 追加探索 (`area-search-results.tsx` の handleExplore) では
   * `keywordExploration`/`centerExploration`/`radiusExploration` を明示的に指定する。
   */
  discoverySource?: AreaSearchDiscoverySource;
}

/**
 * Google Places 検索 + 既存DB照合を1回のServer Actionで行う。
 * 各検索結果に matchedStore (DB登録済み情報)・中心地点からの距離・半径内外判定を
 * 付与して返す。既存の searchPlacesAction は壊さず維持する。
 *
 * `centerQuery` (中心地点の駅名・住所など) は初回検索時に `resolveSearchCenter` で
 * 緯度経度に解決し、`radiusMeters` とあわせて Places Text Search の `locationBias` に
 * 渡す (`locationBias` は厳密な範囲制限ではないため、範囲外の候補も含まれ得る。
 * 各候補の `isWithinRadius` で範囲内/範囲外を判定する)。
 *
 * `options.pageToken` を指定すると、前回呼び出しで返した `nextPageToken` を使って
 * 次ページを取得する (「もっと読み込む」用)。`keyword`/`centerQuery`/`radiusMeters` は
 * 前回と同じ値を渡し、`options.center` には初回で解決した中心地点を渡すこと
 * (Google Places 側の仕様で検索条件を変えると `pageToken` が無効になる場合がある)。
 */
export async function searchPlacesWithMatchesAction(
  keyword: string,
  centerQuery: string,
  radiusMeters: number,
  options?: SearchPlacesWithMatchesOptions,
): Promise<ActionResult<AreaSearchResultPayload>> {
  if (!keyword.trim()) {
    return failure("キーワードを入力してください");
  }
  if (!centerQuery.trim()) {
    return failure("中心地点を入力してください");
  }
  try {
    const center = options?.center ?? (await resolveSearchCenter(centerQuery));
    if (!center) {
      return failure(
        `中心地点「${centerQuery}」が見つかりませんでした。駅名や住所を少し具体的に入力してください。`,
      );
    }

    const [{ places, nextPageToken }, stores] = await Promise.all([
      searchPlacesPage(keyword, centerQuery, {
        pageToken: options?.pageToken,
        locationBias: { center, radiusMeters },
      }),
      repos.store.list(),
    ]);

    const discoverySource: AreaSearchDiscoverySource =
      options?.discoverySource ?? (options?.pageToken ? "loadMore" : "mainTextSearch");

    const viewModels: AreaSearchPlaceViewModel[] = attachStoreMatches(
      places,
      stores,
    ).map((item) => {
      const distance = distanceMeters(
        center.lat,
        center.lng,
        item.place.lat,
        item.place.lng,
      );
      return {
        ...item,
        distanceMeters: distance,
        isWithinRadius: distance <= radiusMeters,
        discovery: createDiscoveryInfo(discoverySource),
        candidateInfo: null,
      };
    });

    // resolveSearchCenter を呼んだ場合 (=options.center 未指定) は +1 回分とする。
    const apiCallEstimate = options?.center ? 1 : 2;
    const meta = buildTextSearchMeta({
      loadedCount: viewModels.length,
      hasNextPage: nextPageToken !== null,
      currentPageCount: 1,
      apiCallEstimate,
    });

    const candidatePersistence = await persistAreaSearchCandidates(
      viewModels,
      keyword,
      centerQuery,
      center,
      radiusMeters,
    );

    const placesWithCandidateInfo = await attachAreaSearchCandidateInfo(viewModels);

    return success({
      places: placesWithCandidateInfo,
      nextPageToken,
      center,
      radiusMeters,
      meta,
      candidatePersistence,
    });
  } catch (e) {
    return failure(e instanceof Error ? e.message : "検索に失敗しました");
  }
}

/**
 * Nearby Search による手動の深掘り探索 (Issue #104 follow-up)。
 *
 * メイン検索 (Text Search, 最大60件) を補完するため、ユーザーが明示的にボタンを
 * 押した場合のみ、中心地点・半径を指定して Nearby Search を1回呼び出す。
 * 取得した候補は常に `discoverySource = "nearbyExploration"` として返す
 * (UI側で既存結果と `placeId` ベースでマージし、`discovery.sources` を統合する)。
 */
export async function searchNearbyPlacesWithMatchesAction(
  center: SearchCenter,
  radiusMeters: number,
): Promise<ActionResult<AreaSearchResultPayload>> {
  if (radiusMeters <= 0) {
    return failure("検索半径が不正です");
  }
  try {
    const [places, stores] = await Promise.all([
      searchNearbyPlaces({ center, radiusMeters }),
      repos.store.list(),
    ]);

    const viewModels: AreaSearchPlaceViewModel[] = attachStoreMatches(
      places,
      stores,
    ).map((item) => {
      const distance = distanceMeters(
        center.lat,
        center.lng,
        item.place.lat,
        item.place.lng,
      );
      return {
        ...item,
        distanceMeters: distance,
        isWithinRadius: distance <= radiusMeters,
        discovery: createDiscoveryInfo("nearbyExploration"),
        candidateInfo: null,
      };
    });

    const meta = buildTextSearchMeta({
      loadedCount: viewModels.length,
      hasNextPage: false,
      currentPageCount: 1,
      apiCallEstimate: 1,
    });

    const candidatePersistence = await persistAreaSearchCandidates(
      viewModels,
      "",
      "",
      center,
      radiusMeters,
    );

    const placesWithCandidateInfo = await attachAreaSearchCandidateInfo(viewModels);

    return success({
      places: placesWithCandidateInfo,
      nextPageToken: null,
      center,
      radiusMeters,
      meta,
      candidatePersistence,
    });
  } catch (e) {
    return failure(e instanceof Error ? e.message : "Nearby検索に失敗しました");
  }
}

/**
 * Place Detailsのオンデマンド取得 (Issue #104 follow-up)。
 *
 * 一覧検索やNearby Searchでは取得しない電話番号・Webサイト・評価・口コミ数・営業状態を、
 * ユーザーがカードの「詳細取得」を押した1店舗分だけ取得する。検索ではなく補完処理のため、
 * DB照合 (`repos.store.list()` / `attachStoreMatches`) や discovery source の更新は行わない。
 */
export async function getPlaceDetailsForAreaSearchAction(
  placeId: string,
): Promise<ActionResult<PlaceDetailsResult>> {
  if (!placeId || typeof placeId !== "string") {
    return failure("placeId が不正です");
  }
  try {
    const details = await getPlaceDetails(placeId);
    return success(details);
  } catch (e) {
    return failure(e instanceof Error ? e.message : "詳細情報の取得に失敗しました");
  }
}

export async function searchPlacesAction(
  keyword: string,
  area: string,
): Promise<ActionResult<PlaceResult[]>> {
  if (!keyword.trim()) {
    return failure("キーワードを入力してください");
  }
  try {
    const results = await searchPlaces(keyword, area);
    return success(results);
  } catch (e) {
    return failure(e instanceof Error ? e.message : "検索に失敗しました");
  }
}

/**
 * クライアントからは placeId のみ受け取り、サーバー側で Google Places API から
 * 最新データを再取得して保存する。クライアント送信データは一切 DB に書き込まない。
 */
export async function addStoreFromPlaceAction(
  placeId: string,
): Promise<ActionResult<{ id: string }>> {
  if (!placeId || typeof placeId !== "string") {
    return failure("placeId が不正です");
  }
  try {
    const place: PlaceResult | null = await getPlaceById(placeId);
    if (!place) {
      return failure("店舗情報を取得できませんでした");
    }
    const created = await createStoreFromPlaceTx(place);
    revalidateTag(CACHE_TAGS.stores, "max");
    revalidateTag(CACHE_TAGS.stats, "max");
    revalidateTag(CACHE_TAGS.pipeline, "max");
    revalidateTag(CACHE_TAGS.kpi, "max");
    revalidateTag(CACHE_TAGS.actionQueue, "max");
    revalidateTag(CACHE_TAGS.store(created.id), "max");
    return success({ id: created.id }, `「${created.name}」を追加しました`);
  } catch (e) {
    return failure(e instanceof Error ? e.message : "追加に失敗しました");
  }
}

/**
 * 複数の placeId を受け取り、Google Places API から順次再取得して一括追加する。
 * - Clientからは placeId の配列のみ受け取る (PlaceResult全体は渡さない)
 * - 1件失敗しても全体を止めず続行する
 * - API制限を考慮して直列処理
 * - 成功件数・失敗件数・作成した Store ID・失敗した placeId を返す
 */
export async function bulkAddStoresFromPlacesAction(
  placeIds: string[],
): Promise<
  ActionResult<{
    added: number;
    failed: number;
    createdIds: string[];
    failedPlaceIds: string[];
  }>
> {
  if (!Array.isArray(placeIds) || placeIds.length === 0) {
    return failure("追加する店舗を選択してください");
  }

  const uniqueIds = deduplicatePlaceIds(placeIds);
  if (uniqueIds.length === 0) {
    return failure("追加する店舗を選択してください");
  }

  const createdIds: string[] = [];
  const failedPlaceIds: string[] = [];

  for (const placeId of uniqueIds) {
    try {
      const place = await getPlaceById(placeId);
      if (!place) {
        failedPlaceIds.push(placeId);
        continue;
      }
      const created = await createStoreFromPlaceTx(place);
      createdIds.push(created.id);
    } catch {
      failedPlaceIds.push(placeId);
    }
  }

  if (createdIds.length > 0) {
    revalidateTag(CACHE_TAGS.stores, "max");
    revalidateTag(CACHE_TAGS.stats, "max");
    revalidateTag(CACHE_TAGS.pipeline, "max");
    revalidateTag(CACHE_TAGS.kpi, "max");
    revalidateTag(CACHE_TAGS.actionQueue, "max");
    for (const id of createdIds) {
      revalidateTag(CACHE_TAGS.store(id), "max");
    }
  }

  return success({
    added: createdIds.length,
    failed: failedPlaceIds.length,
    createdIds,
    failedPlaceIds,
  });
}
