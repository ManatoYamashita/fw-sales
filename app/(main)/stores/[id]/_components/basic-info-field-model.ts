/**
 * 「店舗の調査情報」カードの 1 項目を描くための純粋な判定 (#335)
 *
 * 描画 (`basic-info-field-row.tsx`) から切り出し、入力欄の種類・未保存の判定・
 * 保存ショートカットの扱い・根拠の表示文を単体で検証できるようにする。
 */

import {
  BASIC_INFO_ORIGIN_LABELS,
  describeBasicInfoOrigin,
  type BasicInfoOrigin,
} from "@/lib/domain/research-review";
import type { DifficultyTier } from "@/lib/domain/basic-info-items";
import type { BasicInfoField } from "@/types/basic-info";

/**
 * 1 行の入力欄 (`Input`) で扱う項目。値が短く、改行を含まないもの。
 *
 * それ以外は `Textarea` で、内容に合わせて高さが伸びる。住所や営業時間は 1 行に
 * 収まらないことが多く、営業時間は曜日ごとに改行されるため Textarea 側に置く。
 * 客単価・席数も「昼 / 夜」「カウンター・テーブル」の内訳が付くと 375px の
 * 1 行に収まらず、Input では横へ流れて読めなくなるため Textarea にする。
 */
export const SINGLE_LINE_KEYS: ReadonlySet<string> = new Set([
  "store_name",
  "opening_date",
  "cuisine_genre",
  "phone",
  "floor_level",
  "review_avg",
  "review_count",
]);

/**
 * 1 行の入力欄を使うか。保存済みの値に改行があれば、短い項目でも Textarea にする
 * (`<input>` は改行を落とすため、開いただけで値が変わってしまう)。
 */
export function usesSingleLineInput(key: string, savedValue: string): boolean {
  return SINGLE_LINE_KEYS.has(key) && !/[\r\n]/.test(savedValue);
}

/**
 * `field-sizing: content` 未対応ブラウザで Textarea を開くときの行数。
 * 改行ごとに、1 行あたりおよそ 40 文字で折り返す前提で数え、1〜8 行に収める。
 * 対応ブラウザでは内容に合わせて伸びるため、この値は高さに効かない。
 */
export function estimateTextareaRows(value: string): number {
  const rows = value
    .split(/\r?\n/)
    .reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / 40)), 0);
  return Math.min(8, Math.max(1, rows));
}

/**
 * 入力中の値が保存済みの値と違うか。
 *
 * 保存時は前後の空白を落とす (`updateBasicInfoFieldAction`) ため、比較も同じ正規化で行う。
 * 空白を足しただけで「保存」が出て、押すと実質同じ値で根拠 (確信度・出典) が
 * 消える、という事故を防ぐ。
 */
export function isDraftDirty(draft: string, savedValue: string): boolean {
  return draft.trim() !== savedValue.trim();
}

/** キー入力のうち、編集中の操作に使うもの。 */
export type FieldKeyCommand = "save" | "cancel" | null;

/**
 * キー入力を保存・取消の操作へ読み替える。
 *
 * - 日本語 IME の変換中 (`isComposing`、または Safari が変換確定の Enter で返す
 *   `keyCode === 229`) は何もしない。変換を確定した Enter で保存しない。
 * - Textarea の Enter は改行のまま。保存は Ctrl / ⌘ + Enter。
 *   1 行の Input の Enter は `<form>` の送信 (ブラウザが IME 中の送信を抑止する) に任せる。
 * - Escape は未保存の変更があるときだけ取消にする。
 */
export function readFieldKeyCommand(
  event: {
    key: string;
    isComposing: boolean;
    keyCode: number;
    ctrlKey: boolean;
    metaKey: boolean;
  },
  options: { multiline: boolean; dirty: boolean },
): FieldKeyCommand {
  if (event.isComposing || event.keyCode === 229) return null;
  if (event.key === "Escape") return options.dirty ? "cancel" : null;
  if (event.key === "Enter" && options.multiline && (event.ctrlKey || event.metaKey)) {
    return "save";
  }
  return null;
}

/** 取得区分の説明。値の信頼度ではなく、その項目がどこで分かるかを表す。 */
export const TIER_DESCRIPTIONS: Record<DifficultyTier, string> = {
  A: "A（公開情報で確認しやすい項目）",
  B: "B（公開情報からの推定になりやすい項目）",
  C: "C（店主へのヒアリングが必要な項目）",
};

/** 由来の表示文。保存上は採用も手入力も `filled_by="manual"` なので、根拠の有無で見分ける。 */
const ORIGIN_DESCRIPTIONS: Record<BasicInfoOrigin, string> = {
  places: `エリア検索（${BASIC_INFO_ORIGIN_LABELS.places}）`,
  typed: "人が入力した値（調査レビューで編集して採用した値を含む）",
  adopted: "AI調査の結果をレビューで採用",
};

/** 値が入っている項目の由来を、画面に出す文にする。 */
export function describeFieldOrigin(field: BasicInfoField): string {
  return ORIGIN_DESCRIPTIONS[describeBasicInfoOrigin(field)];
}

const JST_DATE_TIME = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * 更新日時を日本時間で表示する。サーバ (UTC) とブラウザで同じ文字列になるよう
 * タイムゾーンを固定する (端末の時刻設定に依存させると hydration で食い違う)。
 */
export function formatUpdatedAt(iso: string | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return JST_DATE_TIME.format(date);
}
