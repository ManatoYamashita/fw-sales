/**
 * 通知リンク (`notifications.link_url`) の解釈 (#296)。
 *
 * 通知は店舗詳細 (`/stores/<id>` + 任意のハッシュ/クエリ) を指すことが多いが、
 * 店舗は物理削除されるため、通知だけが残ると「指定された店舗は見つかりません
 * でした」画面へ誘導してしまう。クエリ層はここで店舗 ID を取り出し、存在しない
 * 店舗を指すリンクを無効化してから UI へ渡す。
 */

const STORE_DETAIL_LINK = /^\/stores\/([^/?#]+)(?:[?#].*)?$/;

/** 店舗詳細以外のサブパス (`/stores/new` など) は店舗 ID として扱わない。 */
const NON_STORE_SEGMENTS: ReadonlySet<string> = new Set(["new"]);

/**
 * `link_url` が店舗詳細を指していればその店舗 ID を返す。それ以外は null。
 */
export function extractStoreIdFromLink(link: string | null): string | null {
  if (!link) return null;
  const match = STORE_DETAIL_LINK.exec(link);
  const segment = match?.[1];
  if (!segment) return null;
  const id = decodeSegment(segment);
  if (id === null || NON_STORE_SEGMENTS.has(id)) return null;
  return id;
}

function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}
