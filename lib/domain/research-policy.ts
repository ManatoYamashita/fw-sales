/**
 * 53 項目の research_policy 定義表(AI 店舗調査再設計 Plan v3.2 §7)
 *
 * AI Research Pipeline が各項目について「どこまでの探索・推論を許可するか」を
 * 規定する静的な分類。`lib/domain/basic-info-items.ts` の `default_tier` とは
 * 別軸であり、両者を混同しないこと。
 *
 * - `default_tier`: `BasicInfoField` の値側の必須メタ(confidence/source_urls/
 *   hearing_question のどれが必須か)を規定する**データ契約**。
 * - `research_policy`: AI 調査パイプラインが「その項目についてAPIを呼ぶか・
 *   どう問いかけるか・見つからない場合にどちらに倒すか」を規定する**AI挙動契約**。
 *
 * research_policy の値:
 * - FACT: Web検索して明示的な記述のみを根拠にできる。記述が無いのに推測禁止。
 *   取りうる status: confirmed / conflict / not_found (inferred にはならない)。
 * - ANALYSIS: 断片的事実を根拠にAIが論理的推論を行ってよい。ただし弱い状況証拠
 *   のみから強い断定(confirmed)に飛躍しないこと。
 *   取りうる status: confirmed / inferred / conflict / not_found。
 * - FACT_OR_HEARING: 一次情報(本人発信)の明示があれば confirmed。見つからない
 *   場合、AI は一切推測せず直接 hearing_required に倒す。
 *   取りうる status: confirmed / hearing_required。
 * - HEARING_ONLY: AI検索を一切行わない(API呼び出しコストもかけない)。店主にしか
 *   分からない内部情報として機械的に埋める。
 * - EXTERNAL_DATA_REQUIRED: AI Web検索でもヒアリングでも正確な値を得がたい項目。
 *   AI検索は行わず、営業時の質問文も提供しない(店主も正確な数値を把握して
 *   いないことが多いため)。将来、専用外部データソース連携が実現すれば
 *   FACT/ANALYSIS へ格上げできることを見込んだ命名。
 *
 * 依存方向について: `lib/domain` は `lib/ai` を import しない(basic-info-items.ts
 * と同じ規約)。本ファイルは `lib/domain/basic-info-items.ts` にのみ依存する。
 *
 * 関連: Plan v3.2 §7, §8, §10, §13
 */

import { BASIC_INFO_ITEMS } from "./basic-info-items";

/** research_policy の 5 値。 */
export const RESEARCH_POLICIES = [
  "FACT",
  "ANALYSIS",
  "FACT_OR_HEARING",
  "HEARING_ONLY",
  "EXTERNAL_DATA_REQUIRED",
] as const;

export type ResearchPolicy = (typeof RESEARCH_POLICIES)[number];

export interface ResearchPolicyItemDef {
  key: string;
  research_policy: ResearchPolicy;
}

/**
 * 53 項目・8 カテゴリの research_policy 定義表(Plan v3.2 §7 の一覧表と 1:1 対応)。
 *
 * `BASIC_INFO_ITEMS` と同じ key・同じ並び順を保つ。集合一致は
 * `lib/domain/__tests__/research-policy.test.ts` で検証する。
 */
export const RESEARCH_POLICY_ITEMS: readonly ResearchPolicyItemDef[] = [
  // category_1_basic (14)
  { key: "store_name", research_policy: "FACT" },
  { key: "address", research_policy: "FACT" },
  { key: "opening_date", research_policy: "FACT_OR_HEARING" },
  { key: "business_hours_holidays", research_policy: "FACT" },
  { key: "average_spend_day_night", research_policy: "ANALYSIS" },
  { key: "seat_count", research_policy: "FACT" },
  { key: "cuisine_genre", research_policy: "FACT" },
  { key: "concept", research_policy: "FACT_OR_HEARING" },
  { key: "signature_food_drink", research_policy: "ANALYSIS" },
  { key: "exterior_interior", research_policy: "ANALYSIS" },
  { key: "alacarte_course", research_policy: "FACT" },
  { key: "main_target", research_policy: "ANALYSIS" },
  { key: "operation_style", research_policy: "HEARING_ONLY" },
  { key: "phone", research_policy: "FACT" },

  // category_2_owner (6) — 立地環境・商圏データ
  { key: "location_feature", research_policy: "ANALYSIS" },
  { key: "nearest_station", research_policy: "FACT" },
  { key: "floor_level", research_policy: "FACT" },
  { key: "trade_area", research_policy: "ANALYSIS" },
  { key: "population_day_night", research_policy: "ANALYSIS" },
  { key: "visit_method", research_policy: "ANALYSIS" },

  // category_3_menu (4) — 店主のプロフィール・想い
  { key: "owner_profile", research_policy: "FACT_OR_HEARING" },
  { key: "owner_career", research_policy: "FACT_OR_HEARING" },
  { key: "owner_philosophy", research_policy: "FACT_OR_HEARING" },
  { key: "owner_sns", research_policy: "FACT" },

  // category_4_customer (7) — 市場環境・ネット露出・認知度
  { key: "competitor_stores", research_policy: "ANALYSIS" },
  { key: "competitor_benchmark", research_policy: "ANALYSIS" },
  { key: "competitor_paid_ads", research_policy: "ANALYSIS" },
  { key: "own_net_exposure", research_policy: "ANALYSIS" },
  { key: "search_volume", research_policy: "EXTERNAL_DATA_REQUIRED" },
  { key: "market_demand", research_policy: "ANALYSIS" },
  { key: "exposure_gap", research_policy: "ANALYSIS" },

  // category_5_marketing (8) — 認知の質・ブランドイメージ
  { key: "media_coverage", research_policy: "FACT" },
  { key: "strength_message_clarity", research_policy: "ANALYSIS" },
  { key: "review_tendency", research_policy: "ANALYSIS" },
  { key: "negative_reviews", research_policy: "FACT" },
  { key: "review_avg", research_policy: "FACT" },
  { key: "review_count", research_policy: "FACT" },
  { key: "usage_concept_gap", research_policy: "ANALYSIS" },
  { key: "appeal_gap", research_policy: "ANALYSIS" },

  // category_6_competitor (8) — 予約・集客・売上・経営状況
  { key: "reservation_tool", research_policy: "FACT" },
  { key: "reservation_volume_gap", research_policy: "HEARING_ONLY" },
  { key: "main_reservation_channel", research_policy: "HEARING_ONLY" },
  { key: "seat_utilization", research_policy: "HEARING_ONLY" },
  { key: "revenue", research_policy: "HEARING_ONLY" },
  { key: "current_media_and_cost", research_policy: "HEARING_ONLY" },
  { key: "current_growth_actions", research_policy: "HEARING_ONLY" },
  { key: "management_summary", research_policy: "HEARING_ONLY" },

  // category_7_owned_media (4) — 公式サイト・自社発信
  { key: "official_site", research_policy: "FACT" },
  { key: "sns_accounts", research_policy: "FACT" },
  { key: "sns_update_frequency", research_policy: "FACT" },
  { key: "other_owned_outreach", research_policy: "FACT" },

  // category_8_other (2) — 今後の目標・お困り事
  { key: "future_goals", research_policy: "HEARING_ONLY" },
  { key: "top_priority_issue", research_policy: "HEARING_ONLY" },
] as const;

/** key → research_policy の逆引きマップ。 */
export const RESEARCH_POLICY_BY_KEY: ReadonlyMap<string, ResearchPolicy> = new Map(
  RESEARCH_POLICY_ITEMS.map((item) => [item.key, item.research_policy]),
);

export function getResearchPolicy(key: string): ResearchPolicy | undefined {
  return RESEARCH_POLICY_BY_KEY.get(key);
}

/**
 * `BASIC_INFO_ITEMS` の key 集合との整合を起動時に自己検証する。
 * ずれた場合は import 時点で例外を投げ、Source of Truth の乖離を即座に検知する
 * (`basic-info-items.ts` 自身は同種の自己検証を持たないため、本ファイル側で
 * 「両表の同期」を保証する)。
 */
function assertKeySetMatchesBasicInfoItems(): void {
  const basicInfoKeys = new Set(BASIC_INFO_ITEMS.map((item) => item.key));
  const policyKeys = new Set(RESEARCH_POLICY_ITEMS.map((item) => item.key));
  if (basicInfoKeys.size !== policyKeys.size) {
    throw new Error(
      `RESEARCH_POLICY_ITEMS (${policyKeys.size}) と BASIC_INFO_ITEMS (${basicInfoKeys.size}) の項目数が一致しません。`,
    );
  }
  for (const key of basicInfoKeys) {
    if (!policyKeys.has(key)) {
      throw new Error(`BASIC_INFO_ITEMS の key "${key}" に対応する research_policy が定義されていません。`);
    }
  }
}

assertKeySetMatchesBasicInfoItems();
