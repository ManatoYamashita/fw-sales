"use server";

import { revalidateTag } from "next/cache";
import { repos } from "@/lib/repositories";
import { CACHE_TAGS } from "@/lib/cache";
import { searchPlaces, searchPlacesPage, getPlaceById } from "@/lib/places/google";
import { placeResultToStoreInput } from "@/lib/places/to-store-input";
import { placeResultToBasicInfo } from "@/lib/places/to-basic-info";
import { attachStoreMatches } from "@/lib/places/match-store";
import { deduplicatePlaceIds } from "@/lib/places/bulk-utils";
import type {
  AreaSearchResultPayload,
  PlaceResult,
} from "@/lib/places/types";
import { success, failure, type ActionResult } from "./_helpers";

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

/**
 * Google Places 検索 + 既存DB照合を1回のServer Actionで行う。
 * 各検索結果に matchedStore (DB登録済み情報) を付与して返す。
 * 既存の searchPlacesAction は壊さず維持する。
 *
 * `pageToken` を指定すると、前回呼び出しで返した `nextPageToken` を使って次ページを
 * 取得する (「もっと読み込む」用)。`keyword`/`area` は前回と同じ値を渡すこと
 * (Google Places 側の仕様で検索条件を変えると `pageToken` が無効になる場合がある)。
 */
export async function searchPlacesWithMatchesAction(
  keyword: string,
  area: string,
  pageToken?: string,
): Promise<ActionResult<AreaSearchResultPayload>> {
  if (!keyword.trim()) {
    return failure("キーワードを入力してください");
  }
  try {
    const [{ places, nextPageToken }, stores] = await Promise.all([
      searchPlacesPage(keyword, area, pageToken ? { pageToken } : undefined),
      repos.store.list(),
    ]);
    return success({ places: attachStoreMatches(places, stores), nextPageToken });
  } catch (e) {
    return failure(e instanceof Error ? e.message : "検索に失敗しました");
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
