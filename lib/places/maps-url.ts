/**
 * Place ID から Google マップの店舗 URL を組み立てる共有ヘルパ。
 *
 * ## なぜ共有するのか
 *
 * `placeResultToStoreInput` は `googleMapsUri` が無い Place のために Maps URL を
 * 生成し、その値が `stores.map_url` に保存される。ユーザーはその URL をコピーして
 * URL Import へ貼り直しうるため、**repo 自身が生成する URL を URL Import が
 * 拒否する**状態は不整合になる(実際に Issue #207 直後はそうなっていた)。
 *
 * 生成側と受付側 (`lib/url-parser/url-import-policy.ts`) で文字列仕様が
 * drift しないよう、生成は必ずこの 1 箇所を通す。round-trip
 * (生成 → policy が受理する) は
 * `lib/url-parser/__tests__/url-import-policy.test.ts` で固定している。
 *
 * 純関数。ネットワーク・環境変数に依存しない。
 */

/** Google Maps URLs (Search action) のエンドポイント。 */
const MAPS_SEARCH_ENDPOINT = "https://www.google.com/maps/search/";

/**
 * Google Maps URLs の Search 形式で、1 店舗を一意に指す URL を組み立てる。
 *
 * ## 公式仕様への準拠
 *
 * Google Maps URLs の Search action では **`query` が必須**であり、
 * `query_place_id` を使う場合も `query` と**併記**する必要がある
 * (`query_place_id` 単独の形式は公式に有効な Search URL として保証されていない)。
 * そのため本関数は常に両方を出力する。
 *
 * - `query` — 表示・fallback 用の検索語 (店舗名 / 住所 / `lat,lng`)
 * - `query_place_id` — 実際の店舗特定に使う Place ID
 *
 * ## encoding
 *
 * 手書きの文字列連結はしない。`URLSearchParams` で組み立てることで、店舗名に
 * 空白・日本語・`&`・`#`・`+` 等が含まれても query parameter が壊れない。
 * Place ID も内部文字集合を仮定せず、同じ経路で encode する。
 *
 * @param placeId Google Place ID
 * @param query 表示用の検索語。通常は店舗名
 */
export function buildPlaceIdMapsUrl(placeId: string, query: string): string {
  const params = new URLSearchParams({ api: "1" });
  // `query` は必須。店舗名が空の Place でも有効な URL を返せるよう、
  // 空のときだけ Place ID 自身を検索語に使う (空の `query=` を出さない)。
  params.set("query", query.trim() || placeId);
  params.set("query_place_id", placeId);
  return `${MAPS_SEARCH_ENDPOINT}?${params.toString()}`;
}
