/**
 * `ModalContent` / `ModalFooter` の**高さとスクロールの契約**を担うクラス定数 (#225 Phase 1)。
 *
 * ## なぜ定数モジュールに切り出すのか
 * このリポジトリの vitest は node 環境で jsdom を持たない。`modal.tsx` は
 * `typeof document === "undefined"` で早期 return する (`modal.tsx`) ため、
 * `renderToStaticMarkup(<ModalContent/>)` は空文字列を返し、DOM 構造を検証できない。
 * そこで `data-table-responsive.ts` と同じ手を採る — クラス文字列を定数として
 * export し、(1) ソース逐語検査 (2) 本物の Tailwind による CSS 生成検査
 * (3) `modal.tsx` への配線検査 の 3 段で担保する。
 *
 * ## 修正前に何が壊れていたか
 * ダイアログにもボディにも高さ制約がなかった。オーバーレイは
 * `fixed inset-0 flex items-center` かつ `overflow` 未指定 (= visible) なので、
 * 中身が viewport より高いと**上下対称にはみ出す**。さらに
 * `document.body.style.overflow = "hidden"` で背景スクロールも殺されているため、
 * フッタの確定 / キャンセルボタンへ物理的に到達できなかった。
 *
 * ## 設計上の要点 (触る前に必ず読むこと)
 *
 * ### 1. `min-h-0` は飾りではない
 * column フレックスアイテムの自動最小サイズ (`min-height: auto` = コンテンツ由来) を
 * 解除する。**これが無いとボディが縮まず `max-h-full` が一切効かない。**
 * 消しても何のエラーも出ず、症状は「長いモーダルでフッタに届かない」だけ。
 *
 * ### 2. `max-h-full` であって `max-h-[calc(100dvh-2rem)]` ではない
 * `max-height: 100%` はフレックスコンテナ (= オーバーレイ) のコンテンツボックス高に
 * 解決する。オーバーレイは `fixed inset-0 p-4` なのでその高さは「viewport − 2rem」
 * そのものであり、**`p-4` の値をクラス文字列へ複製せずに済む**。
 * calc で書くと、将来オーバーレイの padding を変えた瞬間に無言でズレる。
 * この結合を守るため、`MODAL_OVERLAY_CLASS` から `p-4` を外してはいけない
 * (テストで固定している)。
 *
 * ### 3. フッタは `bottom-0` ではなく `-bottom-4` で貼り付ける
 * sticky の貼り付き位置は**スクロールポートの padding box** を基準に測る。ボディは
 * `py-4` を持つので、`bottom-0` はフッタをボディ下端より 16px 内側へ引き寄せる。
 * 一方フッタの静的位置は `-mb-4` によってちょうどその 16px 下 (= ダイアログの内側
 * 下端) にある。つまり `bottom-0` だと**スクロールが無いときですらフッタが 16px
 * 浮き**、短いモーダル 6 箇所の見た目が変わってしまう。
 *
 * `-bottom-4` は貼り付き位置を静的位置に一致させるため、
 * - 非スクロール時: シフト量 0 → 既存の見た目が 1px も変わらない
 * - スクロール時  : ダイアログの内側下端に貼り付く
 * の両方を満たす。実測 (viewport 682px) で確認済み:
 *   短い  BEFORE / `-bottom-4` … フッタ下端とダイアログ下端の差はどちらも 1px (border)
 *   長い  BEFORE               … ダイアログ高 3140px、フッタは viewport の 1236px 下
 *   長い  `-bottom-4`          … ダイアログ高 650px、フッタは viewport 内で下端に密着
 *
 * `-mx-5 -mb-4` はボディの `px-5 py-4` を打ち消してフッタを枠いっぱいに広げる役目も
 * 担っている。`-bottom-4` とセットで意味を持つので、片方だけ外さないこと。
 *
 * ### 4. オーバーレイに `overflow-y-auto` を付けてはいけない
 * オーバーレイには「クリックで閉じる」ハンドラが付いている。スクロールバーが出ると
 * **バーをドラッグしただけでモーダルが閉じる**古典的なバグになる。
 * ダイアログ側が `max-h-full` で必ず収まるので、そもそも overflow は発生しない。
 *
 * ### 5. ヘッダは sticky ではなく `shrink-0`
 * `flex flex-col` 構成ではヘッダはスクロールコンテナ (ボディ) の**外側**にあるため、
 * そもそもスクロールアウトしない。sticky にすると不透明背景と z-index の管理が
 * 増えるだけで得がない。
 *
 * ### 6. フッタの背景は不透明でなければならない
 * sticky でスクロール中の本文の上に乗るため、`bg-muted/30` のような半透明では
 * 文字が透ける。`--color-modal-footer` (app/globals.css) が従来の実効色を
 * 不透明のまま保存している。
 */

export type ModalSize = "sm" | "md" | "lg";

/**
 * オーバーレイ。`p-4` は `MODAL_DIALOG_CLASS` の `max-h-full` が参照する余白なので
 * 変更するとダイアログの最大高も一緒に変わる (それが意図した結合)。
 */
export const MODAL_OVERLAY_CLASS =
  "fixed inset-0 z-50 flex items-center justify-center p-4 bg-foreground/40 backdrop-blur-sm animate-fade-in";

/**
 * ダイアログ本体。`overflow-clip` は sticky フッタの不透明帯が `rounded-xl` の
 * 下角を四角く切るのを防ぐ。`hidden` ではなく `clip` を使うのは、`hidden` が
 * スクロールコンテナを生成してしまうため (globals.css の `overflow-x: clip` と同方針)。
 */
export const MODAL_DIALOG_CLASS =
  "flex flex-col w-full max-h-full overflow-clip bg-popover text-popover-foreground border border-border rounded-xl shadow-modal animate-slide-up";

/** ヘッダ。スクロール領域の外側に固定する。 */
export const MODAL_HEADER_CLASS =
  "shrink-0 flex items-start justify-between gap-4 px-5 py-4 border-b border-border";

/**
 * ボディ = 唯一のスクロール領域。`flex-1` は付けない
 * (`flex: 0 1 auto` + `min-h-0` で「必要なときだけ縮む」が正しく、`flex-1` は
 * `flex-basis: 0` を持ち込んで短いモーダルの高さ計算を揺らす)。
 * `overscroll-contain` は iOS のラバーバンドが背景ページへ連鎖するのを止める。
 *
 * このクラスを載せた要素は**必ず `tabIndex={0}` と併せて使うこと**。フッタが sticky に
 * なったことで「focusable な子を持たないスクローラを自動で focusable にする」ブラウザの
 * ヒューリスティクスが空振りし、キーボードだけではスクロールできなくなるため
 * (`modal.tsx` の該当箇所と `modal-wiring.test.ts` を参照)。
 */
export const MODAL_BODY_CLASS =
  "min-h-0 overflow-y-auto overscroll-contain px-5 py-4";

/** フッタ。スクロール領域の中に留まりつつ、ダイアログの内側下端へ貼り付く。 */
export const MODAL_FOOTER_CLASS =
  "sticky -bottom-4 z-10 flex items-center justify-end gap-2 px-5 py-3 border-t border-border bg-modal-footer -mx-5 -mb-4 mt-4";

/**
 * `size` prop は**幅のみ**を決める。
 * 高さは `MODAL_DIALOG_CLASS` の `max-h-full` が一元管理しており、size では変えない。
 * (旧 `sizeClass` から改名。「size が幅しか意味していない」ことが本欠陥の遠因だったため、
 *  名前で固定する。)
 */
export const MODAL_WIDTH_CLASS: Readonly<Record<ModalSize, string>> = {
  sm: "max-w-md",
  md: "max-w-lg",
  lg: "max-w-2xl",
} as const;
