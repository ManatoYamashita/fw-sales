/**
 * `basic_info.nearest_station.value` を一覧表示・検索・並び替え用に正規化する。
 *
 * DB からの読取時は `basic_info` の外側だけが防御されており、項目内部に破損データが
 * 混入する可能性があるため、ランタイム値を `unknown` として検証する。
 */
export function getNearestStationValue(basicInfo: unknown): string | null {
  if (
    basicInfo === null ||
    typeof basicInfo !== "object" ||
    Array.isArray(basicInfo)
  ) {
    return null;
  }

  const field = (basicInfo as Record<string, unknown>).nearest_station;
  if (field === null || typeof field !== "object" || Array.isArray(field)) {
    return null;
  }

  const value = (field as Record<string, unknown>).value;
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}
