/**
 * DataTable の列をコンテナ幅で段階表示するためのクラス定義 (#220 / PR2/3)。
 *
 * ## なぜ viewport ではなくコンテナ幅なのか
 * サイドバーは実行時に折りたためる (`md:w-60` 240px ⇔ `md:w-16` 64px) ため、同じ
 * viewport でもテーブルの表示領域は 176px 変動する。viewport ブレークポイントでは
 * 常に「展開時」の最悪ケースで設計せざるを得ず、折りたたみ時の 176px を捨てることに
 * なる。コンテナクエリならサイドバー開閉に JS ゼロで追従し、閾値も実測値をそのまま
 * 書ける。
 *
 * ## なぜ「閾値未満で隠す」1 本なのか (「既定で隠し閾値以上で出す」2 本ではなく)
 * 後者は、Tailwind がクラスを生成し損ねた / コンテナのクラスが付かなかった /
 * ブラウザが container query 非対応、のいずれの経路でも**列が永久に消える**
 * (画面からデータが消える無言の事故)。前者はどの経路でも「全列表示 = 現状維持
 * (横スクロールが残るだけ)」に劣化する。安全側に倒れる方を選ぶ。
 *
 * ## なぜ名前付きコンテナなのか
 * 無名コンテナは「最も近い祖先」を参照する。将来 `Card` や `main` に `@container`
 * が付いた瞬間、閾値の基準が無言でズレる。名前付きならその事故が構造的に起こらず、
 * 「コンテナが存在しなければクエリが一切マッチしない = 全列表示」というフェイル
 * セーフも同時に得られる。
 */

/** DataTable のスクロールラッパに置く名前付きコンテナ。 */
export const DATA_TABLE_CONTAINER_CLASS = "@container/data-table";

/**
 * 「この幅未満なら隠す」クラス (選択列なし)。
 *
 * キーは `ColumnDef.minContainerWidth` = **その列を表示するのに必要なコンテナ幅**。
 * 値はその裏返しで、`@container (width < キー)` のときに `display: none` にする。
 *
 * **値は必ずリテラル文字列で書くこと。** Tailwind はソースを静的走査してクラス名を
 * 集めるため、`` `@max-[${n}px]/data-table:hidden` `` のような実行時生成では CSS が
 * 生成されない。しかもその失敗は無言 (単に横スクロールが残るだけ) で気づけないため、
 * `__tests__/data-table-responsive.test.ts` がソーステキストを直接検査している。
 *
 * ## 閾値は 1 本のはしごではなく、**テーブルごとの列予算の和集合**である
 * 複数の画面が同じマップを共有するため、キーは画面をまたいで交互に噛み合う。
 * キーを足すときは必ず「どの画面のどの列か」をコメントに書くこと。
 *
 * ### /stores 一覧 (#220) — always = 店舗名260 + 次回アクション272 + 操作100 = 632
 *   728 = +状態96 / 874 = +現在の営業状態146 / 971 = +営業担当97
 *  1171 = +最寄駅200 / 1281 = +チャネル110 / 1391 = +最終営業日110 / 1492 = +業態101
 *
 * ### /dashboard 最近登録した店舗 (#224) — always = 店舗名200 + 状態96 = 296
 *   406 = +チャネル110 / 516 = +更新110 / 652 = +エリア136 / 792 = +業態140
 *
 * 652 だけは実測ではなく、コンテナ平地 654px (768px 折畳 / 1280px 展開の 2 構成が
 * 同値) にエリア列を載せるため `maxWidth` を 136px へ意図的に締めた結果。予算を
 * 160px にすると閾値が 676 になり、22px 足りずにその平地で落ちる。
 *
 * ## 新しいキーを足すときの制約
 * **どの 2 キーも {@link SELECTION_COLUMN_WIDTH} ちょうど離れてはいけない。**
 * 離れていると `HIDE_BELOW[b]` と `HIDE_BELOW_WITH_SELECTION[b - 48]` が同一文字列に
 * なり、`__tests__/data-table-responsive-css.test.ts` の
 * 「ユニークなクエリ数 === トークン数」が**原因の分からないメッセージで**落ちる。
 * `__tests__/data-table-responsive.test.ts` に、原因を名指しする先回りのガードがある。
 */
const HIDE_BELOW = {
  406: "@max-[406px]/data-table:hidden", // #224 dashboard: +チャネル
  516: "@max-[516px]/data-table:hidden", // #224 dashboard: +更新
  652: "@max-[652px]/data-table:hidden", // #224 dashboard: +エリア
  728: "@max-[728px]/data-table:hidden", // #220 stores:    +状態
  792: "@max-[792px]/data-table:hidden", // #224 dashboard: +業態
  874: "@max-[874px]/data-table:hidden", // #220 stores:    +現在の営業状態
  971: "@max-[971px]/data-table:hidden", // #220 stores:    +営業担当
  1171: "@max-[1171px]/data-table:hidden", // #220 stores:  +最寄駅
  1281: "@max-[1281px]/data-table:hidden", // #220 stores:  +チャネル
  1391: "@max-[1391px]/data-table:hidden", // #220 stores:  +最終営業日
  1492: "@max-[1492px]/data-table:hidden", // #220 stores:  +業態
} as const;

/**
 * 選択列 (admin の一括操作チェックボックス) が描画される幅。実測値。
 *
 * この値は 2 本のマップの差分であると同時に、**閾値キー同士が取ってはいけない間隔**
 * でもある (詳細は {@link HIDE_BELOW} のドックコメント)。
 */
export const SELECTION_COLUMN_WIDTH = 48;

/**
 * 同上、選択列 48px を足した閾値。キー集合は {@link HIDE_BELOW} と一致させる。
 *
 * issue #220 は当初「閾値は非 admin の累計で定義し、admin は最大 48px の横スクロールを
 * 許容する」としていたが、実数を当てると admin の 1024px サイドバー展開は
 * `48 + 632 + 96 = 776 > 734` となり、**主要ゴールがちょうど未達帯の中**に落ちる。
 * 現行ユーザーは全員 admin なので、それでは誰もゴールに到達しない。選択列の有無で
 * 閾値そのものを切り替える。
 */
const HIDE_BELOW_WITH_SELECTION = {
  406: "@max-[454px]/data-table:hidden",
  516: "@max-[564px]/data-table:hidden",
  652: "@max-[700px]/data-table:hidden",
  728: "@max-[776px]/data-table:hidden",
  792: "@max-[840px]/data-table:hidden",
  874: "@max-[922px]/data-table:hidden",
  971: "@max-[1019px]/data-table:hidden",
  1171: "@max-[1219px]/data-table:hidden",
  1281: "@max-[1329px]/data-table:hidden",
  1391: "@max-[1439px]/data-table:hidden",
  1492: "@max-[1540px]/data-table:hidden",
} as const;

/**
 * `ColumnDef.minContainerWidth` が取りうる値。
 *
 * 任意の数値を許すと Tailwind が対応クラスを持たず無言で効かなくなるため、
 * マップのキーに型で縛る。新しい閾値が要るときは 2 本のマップへリテラルを追加する。
 */
export type ColumnMinContainerWidth = keyof typeof HIDE_BELOW;

/** テストとレンダリングが同じ表を見るための読み取り専用ビュー。 */
export const COLUMN_HIDE_CLASSES: Readonly<Record<ColumnMinContainerWidth, string>> =
  HIDE_BELOW;
export const COLUMN_HIDE_CLASSES_WITH_SELECTION: Readonly<
  Record<ColumnMinContainerWidth, string>
> = HIDE_BELOW_WITH_SELECTION;

/** {@link resolveColumnHideClass} が参照する `ColumnDef` の部分形。 */
export interface ColumnResponsiveInput {
  minContainerWidth?: ColumnMinContainerWidth;
  sortKey?: string;
}

export interface ColumnHideClassOptions {
  /** 現在 URL で有効なソートキー。`ColumnDef.sortKey` と比較する。 */
  activeSortKey?: string;
  /** 選択列 (チェックボックス) を描画しているか。閾値に 48px 加算される。 */
  hasSelectionColumn?: boolean;
}

/**
 * 列に付ける「狭いと隠す」クラスを返す。常時表示なら `undefined`。
 *
 * ソート中の列は閾値を無視して常に表示する。`SortableHeader` は asc ↔ desc の
 * トグルしか持たず「ソート解除」状態が無いため、ソート中の列が隠れると並び順の
 * 手掛かりが画面から消え、方向も変えられなくなるから (issue #220 要件 5)。
 * その結果コンテナ予算を超えて横スクロールが戻ることはあるが、**ユーザーが明示的に
 * 選んだ列を隠さない**方を優先する意図的なトレードオフ。
 *
 * 比較対象は `key` ではなく **`sortKey`**。最終営業日のように
 * `key: "updated"` / `sortKey: "meeting"` と食い違う列があり、`key` で比較すると
 * 無言で機能しなくなる。
 */
export function resolveColumnHideClass(
  col: ColumnResponsiveInput,
  { activeSortKey, hasSelectionColumn }: ColumnHideClassOptions = {},
): string | undefined {
  if (col.minContainerWidth === undefined) return undefined;
  if (col.sortKey !== undefined && col.sortKey === activeSortKey) return undefined;
  return hasSelectionColumn
    ? HIDE_BELOW_WITH_SELECTION[col.minContainerWidth]
    : HIDE_BELOW[col.minContainerWidth];
}
