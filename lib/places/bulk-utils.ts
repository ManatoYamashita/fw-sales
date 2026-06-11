import type { PlaceWithMatch } from "./types";

/**
 * placeId 配列から重複・空文字を除いた配列を返す純関数。
 * bulkAddStoresFromPlacesAction の前処理として使用し、
 * 同一 placeId の重複登録を防ぐ。
 */
export function deduplicatePlaceIds(placeIds: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of placeIds) {
    if (id && !seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result;
}

/** `mergeUniquePlacesWithStats` の戻り値。 */
export interface MergePlacesStats<T> {
  /** 重複除去後の統合結果 (`current` の後ろに `incoming` の新規分を追記したもの)。 */
  merged: T[];
  /** `incoming` のうち新規に追加された件数。 */
  addedCount: number;
  /** `incoming` のうち `current` と重複していて破棄された件数。 */
  duplicateCount: number;
}

/**
 * 既存の検索結果 (`current`) に、追加取得結果 (`incoming`) を
 * `place.placeId` ベースで重複除去しながら追記し、追加件数・重複件数も返す純関数。
 *
 * 「もっと読み込む」「追加探索」のいずれでも、既に表示中の店舗と同じ `placeId` が
 * 含まれる場合に重複表示・重複選択を防ぐ。`current` 側を優先し、`incoming` 側の
 * 重複分は破棄する。
 */
export function mergeUniquePlacesWithStats<T extends PlaceWithMatch>(
  current: readonly T[],
  incoming: readonly T[],
): MergePlacesStats<T> {
  const seen = new Set(current.map(({ place }) => place.placeId));
  const newOnes: T[] = [];
  let duplicateCount = 0;
  for (const item of incoming) {
    if (seen.has(item.place.placeId)) {
      duplicateCount++;
      continue;
    }
    seen.add(item.place.placeId);
    newOnes.push(item);
  }
  return { merged: [...current, ...newOnes], addedCount: newOnes.length, duplicateCount };
}

/**
 * 既存の検索結果 (`current`) に、追加ページ取得結果 (`incoming`) を
 * `place.placeId` ベースで重複除去しながら追記する純関数。
 *
 * 「もっと読み込む」で取得したページに、既に表示中の店舗と同じ `placeId` が
 * 含まれる場合に重複表示・重複選択を防ぐ。`current` 側を優先し、`incoming` 側の
 * 重複分は破棄する。
 */
export function mergeUniquePlaces<T extends PlaceWithMatch>(
  current: readonly T[],
  incoming: readonly T[],
): T[] {
  return mergeUniquePlacesWithStats(current, incoming).merged;
}
