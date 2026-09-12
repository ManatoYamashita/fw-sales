/**
 * Place ID から Google マップの店舗 URL を組み立てる共有ヘルパ。
 *
 * ## なぜ共有するのか
 *
 * `placeResultToStoreInput` は `googleMapsUri` が無い Place のために
 * `…/maps/search/?api=1&query_place_id=<ID>` を fallback として生成し、
 * その値が `stores.map_url` に保存される。ユーザーはその URL をコピーして
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

/**
 * Maps URL API の形式で、1 店舗を一意に指す URL を組み立てる。
 *
 * `api=1` は Maps URL API のバージョン指定。店舗の特定は `query_place_id` が行う。
 * 表示用の `query=<店名>` は**意図的に付けない** — 既存の `stores.map_url` と
 * 1 バイトも変えないため(この関数は既存の文字列リテラルをそのまま関数化したもので、
 * 生成 URL の仕様変更は本 PR のスコープ外)。URL Import 側は `query` 併記の形式も
 * 受け付けるので、将来付けても受付は壊れない。
 */
export function buildPlaceIdMapsUrl(placeId: string): string {
  return `https://www.google.com/maps/search/?api=1&query_place_id=${placeId}`;
}
