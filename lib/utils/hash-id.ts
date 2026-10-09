/**
 * `location.hash` (例: `#sales-assets`) から着地先の要素 id を取り出す。
 *
 * 空のハッシュ、または不正なパーセントエンコード (例: `#%`) のときは null を返す。
 * `decodeURIComponent` は不正な入力で `URIError` を投げ、描画後の effect から投げると
 * ページ全体がエラー画面に変わるため、ここで受け止める (#300 のレビュー指摘)。
 */
export function decodeHashId(hash: string): string | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (raw === "") return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}
