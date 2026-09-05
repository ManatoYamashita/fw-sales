/**
 * トリガに紐づくオーバーレイ (ドロップダウン / ポップオーバー) の**位置**を、
 * 狭幅でビューポート基準へ逃がすためのクラス契約 (Epic #225 Phase 3)。
 *
 * ## 何が起きていたか
 *
 * `absolute right-0` はトリガ (正確には `relative` な包み) の右端にパネルの右端を
 * 合わせる。トリガが画面の左寄りにあると、パネルはそこから**左へ**伸びて画面外へ出る。
 *
 * 実測 (375px viewport):
 *
 * | 箇所 | トリガ右端 | パネル | 可視 |
 * | --- | --- | --- | --- |
 * | `/stores` の絞り込みポップオーバー | 129 | -216..129 (幅 345) | **37%** |
 * | Topbar の通知ドロップダウン | 305 | -15..305 (幅 320) | **95%** |
 *
 * **この破れは `documentElement.scrollWidth` では検出できない。** LTR では左方向の
 * はみ出しがスクロール領域を作らないため、`scrollWidth − clientWidth` は 0 のまま。
 * Issue #261 の棚卸し (scrollWidth 基準) が両方とも見逃していた理由がこれ。
 *
 * ## なぜ幅の上限では直らないか
 *
 * 通知ドロップダウンは既に `max-w-[calc(100vw-2rem)]` を持っていたが、375px では
 * 343px となり `w-80` (320px) を下回らないため**上限として一度も働いていなかった**。
 * 幅を絞っても、右端をトリガに固定している限り左へ出る量は変わらない。**位置の問題を
 * 幅で直すことはできない。**
 *
 * ## なぜブレークポイントでアンカーを左右に切り替えないのか
 *
 * 正しい向きはトリガの x 位置次第で、それはフィルタバーの折返し次第で変わる。実測では
 * 絞り込みトリガが 375/414px で x=25、640/767px では x=511/638 と逆側へ来る。
 * `left-0` 固定にすると後者で 231px 右へ溢れる。**トリガ位置に依存しない基準へ移すのが
 * 唯一の解。**
 *
 * ## 使い方 (2 つで 1 組。片方だけでは成立しない)
 *
 * 包みへ {@link OVERLAY_ANCHOR_CONTAINER}、パネルへ {@link OVERLAY_PANEL_ALIGN_END}
 * (または {@link OVERLAY_PANEL_ALIGN_START}) を付ける。md 未満では包みが `static` に
 * なることでパネルの基準が初期包含ブロック (= ビューポート幅) へ移り、`right-4` が
 * 「画面右端から 16px」を意味するようになる。md 以上は包みが `relative` に戻るため
 * 従来どおりトリガ基準。
 *
 * 包みに他の絶対配置の子 (バッジ等) がある場合は、その子の基準が変わらないよう
 * **子自身に `relative` を持たせること** (`notification-bell.tsx` のボタンがその例)。
 */

/** オーバーレイを包む要素へ。md 未満で位置の基準をビューポートへ移す。 */
export const OVERLAY_ANCHOR_CONTAINER = "static md:relative";

/** 右寄せパネルへ。{@link OVERLAY_ANCHOR_CONTAINER} と対で使う。 */
export const OVERLAY_PANEL_ALIGN_END = "right-4 md:right-0";

/** 左寄せパネルへ。{@link OVERLAY_ANCHOR_CONTAINER} と対で使う。 */
export const OVERLAY_PANEL_ALIGN_START = "left-4 md:left-0";
