"use server";

import { revalidateTag } from "next/cache";
import { repos } from "@/lib/repositories";
import { CACHE_TAGS } from "@/lib/cache";
import { searchPlaces } from "@/lib/places/google";
import { placeResultToStoreInput } from "@/lib/places/to-store-input";
import { success, failure, type ActionResult } from "./_helpers";
import type { PlaceResult } from "@/lib/places/types";

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

export async function addStoreFromPlaceAction(
  place: PlaceResult,
): Promise<ActionResult<{ id: string }>> {
  try {
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
