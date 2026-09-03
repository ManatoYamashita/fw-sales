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
 * 閾値の根拠は issue #220 の実測表 (累計 min-content 幅):
 * always = 店舗名260 + 次回アクション272 + 操作100 = 632
 *   728 = +状態96 / 874 = +現在の営業状態146 / 971 = +営業担当97
 *  1171 = +最寄駅200 / 1281 = +チャネル110 / 1391 = +最終営業日110 / 1492 = +業態101
 */
const HIDE_BELOW = {
  728: "@max-[728px]/data-table:hidden",
  874: "@max-[874px]/data-table:hidden",
  971: "@max-[971px]/data-table:hidden",
  1171: "@max-[1171px]/data-table:hidden",
  1281: "@max-[1281px]/data-table:hidden",
  1391: "@max-[1391px]/data-table:hidden",
  1492: "@max-[1492px]/data-table:hidden",
} as const;

/** 選択列 (admin の一括操作チェックボックス) が描画される幅。実測値。 */
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
  728: "@max-[776px]/data-table:hidden",
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
