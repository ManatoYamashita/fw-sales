/**
 * 基本情報 1 項目の「値の信頼度」の判定 (#335)
 *
 * 店舗詳細の「店舗の調査情報」カードで、各項目の値の横に緑・黄・赤で出す信頼度を決める。
 * 画面ごとに閾値や扱いが揺れないよう、判定はこの純関数だけが持つ。
 *
 * ## 何を根拠にするか
 *
 * 根拠は保存されている `confidence` (0〜100) だけである。
 *
 * - **取得区分 (`tier` の A/B/C) は使わない。** A/B/C は「その項目が Web で取りやすいか」
 *   という項目側の性質で、いま入っている値がどれだけ確かかを表さない。旧表示は空欄にも
 *   既定の区分から「A・高信頼」を出しており、値の信頼度と誤認させていた。
 * - **由来 (`filled_by`) も使わない。** 手入力だから高い、とはしない。調査レビューの採用も
 *   保存上は `filled_by="manual"` になるため、`filled_by` では採用と手入力を区別できない。
 *
 * ## 段階
 *
 * スコアの区切りは `lib/url-parser/confidence-color.ts` の `confidenceTier()` に合わせ、
 * 5 段階を画面の 3 色へ集約する。
 *
 * | スコア     | `confidenceTier` | 表示       |
 * |------------|------------------|------------|
 * | 81〜100    | high             | 緑「高」   |
 * | 70〜80     | medium           | 黄「要確認」 |
 * | 50〜69     | low              | 黄「要確認」 |
 * | 0〜49      | very_low         | 赤「低」   |
 *
 * 次の場合は色を付けない (ニュートラル)。
 *
 * - 値が空 (`null` / 空文字 / 空白のみ): 「未入力」。低信頼の赤にはしない。
 * - スコアが無い (Places 由来・手入力・「編集して採用」): 「未評価」。
 *   人が直した値には元の AI 値のスコアを付け直さない (`buildAdoptedBasicInfoField` が
 *   編集時に `confidence` を落とすのと同じ考え方)。
 * - スコアが数値でない・有限でない・0〜100 の範囲外: 壊れた値として「未評価」。
 *   範囲外を丸めて緑にすると、壊れたデータを高信頼と表示してしまうため丸めない。
 */

import { confidenceTier } from "@/lib/url-parser/confidence-color";
import type { BasicInfoField } from "@/types/basic-info";

/** 色を付ける 3 段階。 */
export type BasicInfoTrustLevel = "high" | "check" | "low";

/** 1 項目の信頼度の判定結果。 */
export type BasicInfoTrust =
  | { kind: "empty" }
  | { kind: "unrated" }
  | { kind: "rated"; level: BasicInfoTrustLevel; score: number };

/** 画面に出す短い状態ラベル。色だけに頼らず、文字でも段階が分かるようにする。 */
export const BASIC_INFO_TRUST_LABELS: Record<BasicInfoTrustLevel | "empty" | "unrated", string> = {
  high: "高",
  check: "要確認",
  low: "低",
  empty: "未入力",
  unrated: "未評価",
};

/** 判定基準の説明。「根拠・詳細」と凡例で同じ文を使う。 */
export const BASIC_INFO_TRUST_CRITERIA: Record<BasicInfoTrustLevel, string> = {
  high: "81 以上",
  check: "50 以上 81 未満",
  low: "50 未満",
};

/** 値が入っているか。`null` / 空文字 / 空白のみは未入力。 */
export function hasBasicInfoValue(field: Pick<BasicInfoField, "value"> | undefined): boolean {
  return typeof field?.value === "string" && field.value.trim() !== "";
}

/**
 * 信頼度スコアを 3 段階へ集約する。判定できない値は `null`。
 *
 * `confidence` は jsonb から読むため、型の上では number でも実際には文字列や
 * `null` が入りうる。`unknown` で受けて自前で確かめる。
 */
export function classifyConfidenceScore(score: unknown): BasicInfoTrustLevel | null {
  if (typeof score !== "number" || !Number.isFinite(score)) return null;
  if (score < 0 || score > 100) return null;
  switch (confidenceTier(score)) {
    case "high":
      return "high";
    case "medium":
    case "low":
      return "check";
    case "very_low":
      return "low";
    default:
      return null;
  }
}

/** 保存されている 1 項目から、画面に出す信頼度を判定する。 */
export function classifyBasicInfoTrust(
  field: Pick<BasicInfoField, "value" | "confidence"> | undefined,
): BasicInfoTrust {
  if (!hasBasicInfoValue(field)) return { kind: "empty" };
  const score: unknown = field?.confidence;
  const level = classifyConfidenceScore(score);
  if (level === null) return { kind: "unrated" };
  return { kind: "rated", level, score: score as number };
}

/** 判定結果の短いラベル (`高` / `要確認` / `低` / `未入力` / `未評価`)。 */
export function basicInfoTrustLabel(trust: BasicInfoTrust): string {
  return trust.kind === "rated"
    ? BASIC_INFO_TRUST_LABELS[trust.level]
    : BASIC_INFO_TRUST_LABELS[trust.kind];
}
