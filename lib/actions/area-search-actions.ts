"use server";

import { revalidateTag } from "next/cache";
import { repos } from "@/lib/repositories";
import { CACHE_TAGS } from "@/lib/cache";
import { searchPlaces, getPlaceById } from "@/lib/places/google";
import { placeResultToStoreInput } from "@/lib/places/to-store-input";
import { attachStoreMatches } from "@/lib/places/match-store";
import type { PlaceResult, PlaceWithMatch } from "@/lib/places/types";
import { success, failure, type ActionResult } from "./_helpers";

/**
 * Google Places 検索 + 既存DB照合を1回のServer Actionで行う。
 * 各検索結果に matchedStore (DB登録済み情報) を付与して返す。
 * 既存の searchPlacesAction は壊さず維持する。
 */
export async function searchPlacesWithMatchesAction(
  keyword: string,
  area: string,
): Promise<ActionResult<PlaceWithMatch[]>> {
  if (!keyword.trim()) {
    return failure("キーワードを入力してください");
  }
  try {
    const [places, stores] = await Promise.all([
      searchPlaces(keyword, area),
      repos.store.list(),
    ]);
    return success(attachStoreMatches(places, stores));
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
    const input = placeResultToStoreInput(place);
    const created = await repos.store.create(input);
    revalidateTag(CACHE_TAGS.stores, "max");
    revalidateTag(CACHE_TAGS.stats, "max");
    revalidateTag(CACHE_TAGS.pipeline, "max");
    revalidateTag(CACHE_TAGS.kpi, "max");
    revalidateTag(CACHE_TAGS.actionQueue, "max");
    return success({ id: created.id }, `「${created.name}」を追加しました`);
  } catch (e) {
    return failure(e instanceof Error ? e.message : "追加に失敗しました");
  }
}
