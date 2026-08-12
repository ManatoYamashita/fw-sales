/**
 * Research Evidence Precedence(feat/ai-research-quality-ux-hardening、Plan §5)。
 *
 * 「このrunで何を根拠にしてよいか」の序列を明文化する単一情報源。
 * `run-timing.ts` と同じく **依存ゼロの純モジュール**として保つ(型のみ import する)。
 *
 * ## 背景(なぜこのモジュールが必要か)
 *
 * 実機検証で、canonical `basic_info` に保持している確定情報が再調査のたびに
 * `not_found` へ退化する事象が確認された。原因は「新しさ(freshness)」と
 * 「信頼度(trust)」が1軸に潰されていたことにある。両者は独立した軸であり、
 * 分離して初めて「古いが人間が確認した値」と「新しいが機械が取得した値」を
 * 正しく扱い分けられる。
 *
 * ## 序列(強い順。実装は本ファイルの定数と `pipeline.ts` の合成関数が担う)
 *
 * - P1 fresh Places      : このrunのStage0が実際にGoogle Placesから取得した値
 * - P2 verified official : url_context成功 + identity target_match + 一次情報source_type
 * - P3 verified secondary: url_context成功 + identity OK(非competitor)
 * - P4 Tier B SearchFact : SOURCE_TRUST_MATRIX許可 + known_store_data + 値が一意
 * - P5 human-reviewed canonical : `basic_info[key]`(stale。`updated_at` の併記が必須)
 * - P6 known app data    : `stores.site_url` 等(**単独ではconfirmedにしない**、下記)
 * - P7 Gemini inference  : `inferred` 止まり
 * - P8 Gemini self-report: **一切信用しない**(`source_type` / `research_policy` / title)
 *
 * ## 本モジュールが扱う範囲
 *
 * P5(canonical fallback)の許可条件のみ。P1〜P4 は既存の
 * `validateResearchItemStatus`(`lib/ai/research-result-schema.ts`)が担う。
 *
 * ## 重要な設計判断: `stores.site_url` は単独で confirmed の根拠にしない
 *
 * 「登録済みURLがある」ことと「今回freshに公式性を確認した」ことは別事象である。
 * `stores.site_url` は Source Registry へ `known_store_data` として seed される
 * (`source-registry.ts:buildKnownStoreDataUrls`)だけで、それ自体は
 * `official_site` 項目の confirmed 根拠にしない。canonical fallback の対象になるのは
 * **human-reviewed な `basic_info.official_site`** のみ。
 */

import type { BasicInfoField, FillSource } from "@/types/basic-info";

/**
 * canonical fallback を許可する key の allowlist。
 *
 * **実機で退化が確認された3項目のみ。** ここを安易に広げると、Research result が
 * 「調査」ではなく「既存値のエコー」になり、そもそもの意味が失われる。
 * 拡張は実機で退化が観測されてから1件ずつ行うこと。
 */
export const CANONICAL_FALLBACK_KEYS = ["review_avg", "review_count", "official_site"] as const;

export type CanonicalFallbackKey = (typeof CANONICAL_FALLBACK_KEYS)[number];

/**
 * canonical fallback で合成した item に付与する `evidence_basis`。
 *
 * `lib/ai/research-result-schema.ts` の `EVIDENCE_BASES` に含まれるが、
 * **Stage2 Structured Output schema(`schema-builder.ts`)へは公開しない**。
 * これにより AI が生成した item の `evidence_basis` は構造的に必ず `undefined` になり、
 * 「コードが合成した item だけが canonical bypass に乗る」ことを
 * `excludeKeys` とは独立に保証できる(二重防御、Plan §7.1.1)。
 */
export const CANONICAL_EVIDENCE_BASIS = "existing_canonical";

export interface CanonicalFallbackRule {
  key: CanonicalFallbackKey;
  /**
   * canonical fallback を許可する `filled_by`。`null` は「問わない」。
   *
   * - `review_avg` / `review_count`: `null`。Places由来(`places`)であっても
   *   「過去に機械的に確認された値」であり、fallback の根拠として妥当。
   * - `official_site`: `"manual"` のみ。Places はこの項目を埋めないため
   *   (`places-verified.ts:PLACES_VERIFIABLE_KEYS` の除外理由を参照)、
   *   `manual` = 人間がアプリへ入力・採用した値であることを意味する。
   */
  requiredFilledBy: FillSource | null;
}

const CANONICAL_FALLBACK_RULES: readonly CanonicalFallbackRule[] = [
  { key: "review_avg", requiredFilledBy: null },
  { key: "review_count", requiredFilledBy: null },
  { key: "official_site", requiredFilledBy: "manual" },
];

const RULE_BY_KEY: ReadonlyMap<string, CanonicalFallbackRule> = new Map(
  CANONICAL_FALLBACK_RULES.map((rule) => [rule.key, rule]),
);

/** allowlist に含まれる key の rule を返す。含まれなければ `undefined`。 */
export function canonicalFallbackRuleFor(key: string): CanonicalFallbackRule | undefined {
  return RULE_BY_KEY.get(key);
}

/**
 * canonical `basic_info` の 1 項目を fallback の根拠として使ってよいかを判定する。
 *
 * 純関数。`stores.site_url` 等のスカラー列は**入力に取らない**
 * (「登録済みURLがある」だけで confirmed にしないため、Plan §7.1)。
 */
export function isCanonicalFallbackAllowed(
  key: string,
  field: BasicInfoField | undefined,
): boolean {
  const rule = RULE_BY_KEY.get(key);
  if (rule === undefined) return false;
  if (field === undefined) return false;
  if (field.value === null || field.value.trim() === "") return false;
  if (rule.requiredFilledBy !== null && field.filled_by !== rule.requiredFilledBy) return false;
  return true;
}
