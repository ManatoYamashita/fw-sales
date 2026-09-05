/**
 * モバイルドロワーのフォーカス制御 (#253)。
 *
 * `sidebar.tsx` は Server Action (`signOutAction`) を import しており、その先の
 * repos → lib/db が実 DB 接続を試みる。純粋な判断だけをこのモジュールへ置くことで、
 * テストが DB のモックを用意せずに全分岐を突けるようにしている。
 */

/** ドロワー内でフォーカスを受け取れる要素のセレクタ。 */
export const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * フォーカストラップで Tab を折り返す先を決める。
 *
 * ドロワーは背後のページを覆うので、Tab がその外へ抜けると「見えない要素を操作して
 * いる」状態になる。
 *
 * @param key `KeyboardEvent.key`
 * @param shiftKey Shift が押されているか
 * @param index いまフォーカスがある要素の、ドロワー内フォーカス可能要素での位置。
 *   ドロワーの外にフォーカスがある場合は -1
 * @param count ドロワー内のフォーカス可能要素数
 * @returns 移動先の index。折り返しが不要ならブラウザ既定に任せるため null
 */
export function resolveDrawerFocusWrap(
  key: string,
  shiftKey: boolean,
  index: number,
  count: number,
): number | null {
  if (key !== "Tab") return null;
  if (count <= 0) return null;
  // ドロワーの外にフォーカスが逃げていたら、進む方向の端から引き戻す。
  if (index < 0) return shiftKey ? count - 1 : 0;
  if (shiftKey) return index === 0 ? count - 1 : null;
  return index === count - 1 ? 0 : null;
}
