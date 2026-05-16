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
