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
 * ## このマップはテーブル横断で共有される (#220 → #224)
 *
 * キーは「あるテーブルの、ある列までの累計 min-content 幅」であって、キー同士に
 * 意味のある順序関係は無い。隣り合うキーが別テーブルの列に属することもある
 * (673 は dashboard の更新列、718 は handoffs の初期・月額列)。どのキーがどの
 * テーブルのものかは下の内訳だけが真実。
 *
 * {@link ColumnMinContainerWidth} はテーブルを区別しないので、他テーブルの閾値を
 * 誤って書いても型では止まらない。検出するのは各テーブルの列テスト (決定表) の役目。
 *
 * ## 内訳 (単体予算 = その列だけの幅。累計ではなく単体を残すこと)
 *
 * ### /stores 一覧 (#220) — always = 店舗名 260 + 次回アクション 272 + 操作 100 = 632
 *    728 = +状態 96     /  874 = +現在の営業状態 146 /  971 = +営業担当 97
 *   1171 = +最寄駅 200  / 1281 = +チャネル 110       / 1391 = +最終営業日 110
 *   1492 = +業態 101
 *
 * ### /dashboard 最近登録した店舗 (#224) — always = 店舗名 200 + 状態 96 = 296
 *    456 = +エリア 160  /  578 = +チャネル 122       /  673 = +更新 95
 *    813 = +業態 140
 *
 * ### /handoffs 引き継ぎ一覧 (#224) — always = 店舗 200 + 状態 120 = 320
 *    428 = +期日 108    /  528 = +運用担当 100       /  718 = +初期・月額 189
 *   (列幅の丸め和は 717 だが、テーブルの実 min-content は 718。累計は合計ではなく
 *    実測の min-content を採ること)
 *   初期・月額は金額なので truncate できない (桁を誤読させる)。上限を付けられない列は
 *   落とす順序の最下位に置き、後続の閾値がずれない位置に閉じ込めてある。
 *
 * 単体予算を必ず併記するのは、累計しか残さないと将来 `DataTable` 本体へ列優先度 API を
 * 昇格させる (Epic #225 Phase 2) ときに累計から自幅へ戻せなくなるため。
 *
 * ## 閾値を足すときの制約
 *
 * 1. **値は必ずリテラル文字列で書くこと。** Tailwind はソースを静的走査してクラス名を
 *    集めるため、テンプレートリテラルで組み立てた瞬間に CSS が生成されない。しかも
 *    その失敗は無言 (単に横スクロールが残るだけ) で気づけないため、
 *    `__tests__/data-table-responsive.test.ts` がソーステキストを直接検査している。
 * 2. **2 本のマップへ同時に足す。** キー集合の一致と px 差 48 はテストが強制する。
 * 3. 新しい閾値 N は既存の全キー M に対して **|N − M| ≠ 48**。破ると
 *    `HIDE_BELOW_WITH_SELECTION[N]` と `HIDE_BELOW[M]` が同じ px になり、CSS 側で
 *    1 本のクエリに畳まれて `data-table-responsive-css.test.ts` の
 *    「生成クエリ数 = トークン数」が落ちる。衝突したら N を**大きい方へ**ずらすこと。
 *    小さくすると累計 < 閾値となり、その帯で横スクロールが無言で戻る。
 * 4. 昇順に並べて書く (単調性テストがある)。
 * 5. **この JSDoc にクラス名の形をした文字列を書かない。** Tailwind が走査して未使用の
 *    CSS を生成する (Epic #225 の方針 D2)。根拠は数値だけで書くこと。
 *
 * #224 の閾値は `/dashboard` `/handoffs` が `lib/domain/nav-routes.ts` で無効化されている
 * 状態での暫定値。ルート再有効化時は列構成ごと再測定すること。
 */
const HIDE_BELOW = {
  428: "@max-[428px]/data-table:hidden",
  456: "@max-[456px]/data-table:hidden",
  528: "@max-[528px]/data-table:hidden",
  578: "@max-[578px]/data-table:hidden",
  673: "@max-[673px]/data-table:hidden",
  718: "@max-[718px]/data-table:hidden",
  728: "@max-[728px]/data-table:hidden",
  813: "@max-[813px]/data-table:hidden",
  874: "@max-[874px]/data-table:hidden",
  971: "@max-[971px]/data-table:hidden",
  1171: "@max-[1171px]/data-table:hidden",
  1281: "@max-[1281px]/data-table:hidden",
  1391: "@max-[1391px]/data-table:hidden",
  1492: "@max-[1492px]/data-table:hidden",
} as const;

/**
 * 選択列 (admin の一括操作チェックボックス) が描画される幅。
 *
 * `w-10` (40px) ではなくチェックボックス 16px + `px-4` 32px = 48px が実効値
 * (`box-sizing: border-box`)。`DataTable` の `density="compact"` は `px-3` になり
 * 40px へ変わるが、現在 `density` を渡している呼び出し元は無い。
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
 *
 * `/dashboard` と `/handoffs` は `rowSelection` を使わないため、#224 で追加した 7 キーの
 * 選択列側クラスは現時点で**未使用 (dead CSS)** になる。キー集合の一致をテストが強制する
 * 以上避けられない意図的な冗長で、「テーブル別にマップを分けない」判断とセット。分けると
 * {@link resolveColumnHideClass} にテーブル種別を渡す必要が生じ、Epic #225 Phase 2 の
 * 「`DataTable` 本体へ列優先度 API を昇格」と正面衝突する。
 */
const HIDE_BELOW_WITH_SELECTION = {
  428: "@max-[476px]/data-table:hidden",
  456: "@max-[504px]/data-table:hidden",
  528: "@max-[576px]/data-table:hidden",
  578: "@max-[626px]/data-table:hidden",
  673: "@max-[721px]/data-table:hidden",
  718: "@max-[766px]/data-table:hidden",
  728: "@max-[776px]/data-table:hidden",
  813: "@max-[861px]/data-table:hidden",
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
 *
 * **この union にはテーブル横断の値が入る** ({@link HIDE_BELOW} の内訳を参照)。型では
 * 取り違えを防げないので、各テーブルの列テストが決定表として `key → 閾値` を固定する。
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
