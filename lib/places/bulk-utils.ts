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

/**
 * 既存の検索結果 (`current`) に、追加ページ取得結果 (`incoming`) を
 * `place.placeId` ベースで重複除去しながら追記する純関数。
 *
 * 「もっと読み込む」で取得したページに、既に表示中の店舗と同じ `placeId` が
 * 含まれる場合に重複表示・重複選択を防ぐ。`current` 側を優先し、`incoming` 側の
 * 重複分は破棄する。
 */
export function mergeUniquePlaces(
  current: readonly PlaceWithMatch[],
  incoming: readonly PlaceWithMatch[],
): PlaceWithMatch[] {
  const seen = new Set(current.map(({ place }) => place.placeId));
  return [
    ...current,
    ...incoming.filter(({ place }) => !seen.has(place.placeId)),
  ];
}
