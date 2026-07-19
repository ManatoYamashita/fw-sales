/**
 * 金額 (整数円) 入力の正規化・表示用純粋関数群 (#172 sales-activity-ux)。
 *
 * - DB 層や React への依存を持たず、Vitest の Node 環境で単体テストできる
 *   (`lib/domain/sales-progress.ts` と同規約)。
 * - 「表示は 3 桁カンマ区切り + 円サフィックス、送信・保存はカンマなしの整数円」
 *   の変換を一箇所に集約する。UI コンポーネントは `components/ui/yen-amount-input.tsx`。
 * - 「10万円」のような日本語単位の補助表示は仕様上禁止のため、本モジュールは
 *   数字とカンマ以外の表示文字列を一切生成しない。
 */

/**
 * 受け付ける金額の上限。deals.estimate_amount / order_amount は PostgreSQL の
 * integer (32bit signed) 型のため、その最大値 2,147,483,647 を超える値は
 * DB 到達前に入力・検証の両段階で拒否する。
 */
export const MAX_YEN_AMOUNT = 2_147_483_647;

const FULLWIDTH_DIGIT_OFFSET = "０".charCodeAt(0) - "0".charCodeAt(0);

/** 全角数字 (０-９) を半角 (0-9) へ正規化する。 */
function toHalfWidthDigits(text: string): string {
  return text.replace(/[０-９]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - FULLWIDTH_DIGIT_OFFSET),
  );
}

/**
 * 任意のテキストから金額の数字列だけを抽出する (入力中の逐次正規化用)。
 *
 * - 全角数字は半角へ変換して残す
 * - 半角カンマ `,`・全角カンマ `，`・読点 `、` は桁区切りとして除去
 *   (カンマ付き貼り付け `1,000,000` を受け付ける)
 * - 半角/全角空白は除去 (前後空白の正規化)
 * - 英字・記号・小数点・負号などその他の文字はすべて除外する
 * - 先頭の余分な 0 は除去する (`007` → `7`。`0` 単独は `0` のまま)
 *
 * 戻り値は canonical な数字列 (空文字 = 未入力)。
 */
export function extractYenDigits(text: string): string {
  const digits = toHalfWidthDigits(text).replace(/[^0-9]/g, "");
  if (digits === "") return "";
  const trimmed = digits.replace(/^0+(?=\d)/, "");
  return trimmed;
}

export type YenAmountParseResult =
  | { ok: true; value: number | null; canonical: string }
  | { ok: false; reason: "invalid" | "out_of_range" };

/**
 * 入力テキストを検証つきでパースする (submit 前の最終正規化・テスト用)。
 *
 * `extractYenDigits` が「不正文字は黙って除外」なのに対し、こちらは
 * 数字・桁区切り・空白以外の文字 (負号・小数点・英字など) が含まれていたら
 * `{ ok: false, reason: "invalid" }` で拒否する。
 *
 * - 空文字 (空白のみ含む) → `{ ok: true, value: null, canonical: "" }` (未入力)
 * - `MAX_YEN_AMOUNT` 超過 → `{ ok: false, reason: "out_of_range" }`
 */
export function parseYenAmount(raw: string): YenAmountParseResult {
  const normalized = toHalfWidthDigits(raw).replace(/[\s　]/g, "");
  if (normalized === "") return { ok: true, value: null, canonical: "" };
  const withoutSeparators = normalized.replace(/[,，、]/g, "");
  if (!/^[0-9]+$/.test(withoutSeparators)) return { ok: false, reason: "invalid" };
  const canonical = withoutSeparators.replace(/^0+(?=\d)/, "");
  // 桁数レベルで先に弾き、Number() の精度劣化 (> 2^53) を経由させない
  if (canonical.length > String(MAX_YEN_AMOUNT).length) return { ok: false, reason: "out_of_range" };
  const value = Number(canonical);
  if (value > MAX_YEN_AMOUNT) return { ok: false, reason: "out_of_range" };
  return { ok: true, value, canonical };
}

/**
 * canonical な数字列を 3 桁カンマ区切りの表示文字列にする。
 * 空文字は空文字のまま返す (未入力は空欄表示、`0` の自動表示はしない)。
 */
export function formatYenDigits(canonical: string): string {
  if (canonical === "") return "";
  return canonical.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
