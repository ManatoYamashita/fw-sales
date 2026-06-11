const EARTH_RADIUS_M = 6_371_000;

/** Haversine公式による2点間の距離 (メートル) */
export function distanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * 距離 (メートル) を表示用文字列に変換する。
 * 1000m未満は整数メートル (例: "320m")、1000m以上はkm単位 (例: "1.2km") で表す。
 * ちょうどキリの良いkm (1000の倍数) は小数点以下を省略する (例: 1000 → "1km")。
 */
export function formatDistanceMeters(meters: number): string {
  if (meters >= 1000) {
    const km = meters / 1000;
    return `${km % 1 === 0 ? km.toFixed(0) : km.toFixed(1)}km`;
  }
  return `${Math.round(meters)}m`;
}
