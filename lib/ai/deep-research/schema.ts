/**
 * Deep Research Stage 2 構造化スキーマ (deep-research-pipeline spec, Issue #43)
 *
 * 8 カテゴリ × 51 項目の Zod スキーマと Gemini API 用 JSON Schema を提供する。
 *
 * - 各項目は `DeepResearchItem` (`types/deep-research.ts`) と同形だが、Zod の
 *   `refine` で tier=B → confidence/source_urls/source_quote 必須、
 *   tier=C → hearing_question 必須 を強制する。
 * - 51 項目の正規化キーマップは本ファイルの `DEEP_RESEARCH_ITEMS` 定数で提供。
 *   Issue #43 §2 の 8 カテゴリテーブルから抽出した。
 * - Stage 2 構造化呼出 (`lib/ai/deep-research/structurer.ts`) は本スキーマで
 *   safeParse() し、違反は `schema_violation` として上位に返す (R3.5 担保)。
 *
 * 設計上の判断:
 * - スキーマは「構造」を強制する。「全 51 項目が出力に含まれること」の coverage
 *   保証はプロンプト側 (`prompt.ts`) と LLM の責務。スキーマレベルで coverage を
 *   refine 化すると、Stage 1 で未取得項目があった場合に全体が `schema_violation`
 *   になりリトライ無効化と矛盾するため。
 *
 * 関連: design.md §Components and Interfaces / Structurer, design.md §Data Models /
 *       Each Category jsonb, requirements.md §3.1, §3.2, §3.3, §3.4, §3.5
 */

import { z } from "zod";
import {
  stripUnsupportedKeys,
  withPropertyOrdering,
} from "@/lib/ai/_shared/json-schema-utils";

/** 取得難易度区分。types/deep-research.ts の `DifficultyTier` と同値。 */
export const DIFFICULTY_TIERS = ["A", "B", "C"] as const;

const TierSchema = z.enum(DIFFICULTY_TIERS);

/**
 * 1 項目の Zod スキーマ。
 *
 * - tier=A: value 必須、source 系は任意
 * - tier=B: value + confidence (0-100) + source_urls + source_quote すべて必須
 * - tier=C: hearing_question 必須、value は null 可
 *
 * refine で tier 別の必須条件を後置検証する。
 */
export const DeepResearchItemSchema = z
  .object({
    key: z.string().min(1),
    label: z.string().min(1),
    tier: TierSchema,
    value: z.string().nullable(),
    confidence: z.number().int().min(0).max(100).optional(),
    source_urls: z.array(z.string()).optional(),
    source_quote: z.string().optional(),
    hearing_question: z.string().optional(),
  })
  .strict()
  .superRefine((item, ctx) => {
    if (item.tier === "B") {
      if (item.confidence === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["confidence"],
          message: "tier=B は confidence (0-100) が必須",
        });
      }
      if (
        item.source_urls === undefined ||
        item.source_urls.length === 0
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["source_urls"],
          message: "tier=B は source_urls (非空配列) が必須",
        });
      }
      if (
        item.source_quote === undefined ||
        item.source_quote.trim() === ""
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["source_quote"],
          message: "tier=B は source_quote (非空文字列) が必須",
        });
      }
    }
    if (item.tier === "C") {
      if (
        item.hearing_question === undefined ||
        item.hearing_question.trim() === ""
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["hearing_question"],
          message: "tier=C は hearing_question (非空文字列) が必須",
        });
      }
    }
  });

const HearingQuestionSchema = z
  .object({
    category: z.string().min(1),
    question: z.string().min(1),
  })
  .strict();

const CategoryArray = z.array(DeepResearchItemSchema);

/**
 * Deep Research レポート全体の Zod スキーマ。8 カテゴリの項目配列と
 * メタ情報 (Markdown 全文、引用 URL 配列、ヒアリング質問配列) を持つ。
 *
 * テーブル列名 (`category_1_basic` 等) と一致させる。
 */
export const DeepResearchReportSchema = z
  .object({
    category_1_basic: CategoryArray,
    category_2_owner: CategoryArray,
    category_3_menu: CategoryArray,
    category_4_customer: CategoryArray,
    category_5_marketing: CategoryArray,
    category_6_competitor: CategoryArray,
    category_7_owned_media: CategoryArray,
    category_8_other: CategoryArray,
    hearing_questions: z.array(HearingQuestionSchema),
    all_source_urls: z.array(z.string()),
  })
  .strict();

/**
 * Gemini API がトップレベルで返すべきフィールドの順序。
 * `propertyOrdering` に明示しないと生成 JSON のフィールド順がぶれ得る
 * (既存 `lib/ai/schema.ts` の AI_ANALYSIS_PROPERTY_ORDERING と同じ理由)。
 */
const REPORT_PROPERTY_ORDERING = [
  "category_1_basic",
  "category_2_owner",
  "category_3_menu",
  "category_4_customer",
  "category_5_marketing",
  "category_6_competitor",
  "category_7_owned_media",
  "category_8_other",
  "hearing_questions",
  "all_source_urls",
] as const;

/**
 * Gemini API `responseJsonSchema` に渡す JSON Schema を返す。
 *
 * `lib/ai/_shared/json-schema-utils.ts` の `stripUnsupportedKeys` で
 * 非対応 key を除去し、`withPropertyOrdering` で順序を埋め込む。
 */
export function getDeepResearchJsonSchema(): Record<string, unknown> {
  const raw = z.toJSONSchema(DeepResearchReportSchema, {
    target: "draft-2020-12",
  });
  const stripped = stripUnsupportedKeys(raw) as Record<string, unknown>;
  return withPropertyOrdering(stripped, REPORT_PROPERTY_ORDERING);
}

// ---------------------------------------------------------------------------
// 8 カテゴリ × 51 項目の正規化キーマップ
// Issue #43 §2 の表から抽出。プロンプト構築 (`prompt.ts`) と UI 凡例で参照。
// ---------------------------------------------------------------------------

/** Default tier は LLM への指示用。実出力では Stage 2 が override する可能性あり。 */
export interface DeepResearchItemKey {
  key: string;
  label: string;
  default_tier: "A" | "B" | "C";
}

export const CATEGORY_LABELS = {
  category_1_basic: "店舗の基本情報・特徴",
  category_2_owner: "立地環境・商圏データ",
  category_3_menu: "店主のプロフィール・想い",
  category_4_customer: "市場環境・ネット露出・認知度",
  category_5_marketing: "認知の質・ブランドイメージ",
  category_6_competitor: "予約・集客・売上・経営状況",
  category_7_owned_media: "公式サイト・自社発信",
  category_8_other: "今後の目標・お困り事",
} as const;

export type CategoryKey = keyof typeof CATEGORY_LABELS;

export const DEEP_RESEARCH_ITEMS: Record<CategoryKey, DeepResearchItemKey[]> = {
  category_1_basic: [
    { key: "store_name", label: "屋号", default_tier: "A" },
    { key: "address", label: "住所", default_tier: "A" },
    { key: "opening_date", label: "オープン日（創業年数）", default_tier: "B" },
    { key: "business_hours_holidays", label: "営業時間・定休日", default_tier: "A" },
    { key: "average_spend_day_night", label: "客単価（昼・夜）", default_tier: "B" },
    { key: "seat_count", label: "席数", default_tier: "B" },
    { key: "cuisine_genre", label: "料理ジャンル（業種）", default_tier: "A" },
    { key: "concept", label: "お店のコンセプト・特徴", default_tier: "B" },
    { key: "signature_food_drink", label: "料理・酒の特徴（名物等）", default_tier: "B" },
    { key: "exterior_interior", label: "外観・内観の特徴", default_tier: "B" },
    { key: "alacarte_course", label: "アラカルト・コースの特徴", default_tier: "B" },
    { key: "main_target", label: "メインターゲット", default_tier: "B" },
    { key: "operation_style", label: "オペレーションの特徴", default_tier: "C" },
  ],
  category_2_owner: [
    { key: "location_feature", label: "立地の特徴", default_tier: "A" },
    { key: "nearest_station", label: "最寄り駅・距離・乗降客数", default_tier: "A" },
    { key: "floor_level", label: "階層", default_tier: "B" },
    { key: "trade_area", label: "周辺商圏の特徴", default_tier: "A" },
    { key: "population_day_night", label: "店舗周辺人口（昼夜）", default_tier: "A" },
    { key: "visit_method", label: "主要な来店手段", default_tier: "B" },
  ],
  category_3_menu: [
    { key: "owner_profile", label: "店主基本情報", default_tier: "C" },
    { key: "owner_career", label: "経歴・修行先", default_tier: "C" },
    { key: "owner_philosophy", label: "店主の想い", default_tier: "C" },
    { key: "owner_sns", label: "店主個人 SNS", default_tier: "A" },
  ],
  category_4_customer: [
    { key: "competitor_stores", label: "商圏内ライバル店舗（最低2件）", default_tier: "A" },
    { key: "competitor_benchmark", label: "ライバル店ベンチマーク", default_tier: "A" },
    { key: "competitor_paid_ads", label: "ライバル有料広告活用有無", default_tier: "B" },
    { key: "own_net_exposure", label: "自店のネット露出状況", default_tier: "A" },
    { key: "search_volume", label: "認知数（屋号月間検索ボリューム）", default_tier: "B" },
    { key: "market_demand", label: "市場需要", default_tier: "B" },
    { key: "exposure_gap", label: "露出の過不足・伸びしろ", default_tier: "B" },
  ],
  category_5_marketing: [
    { key: "media_coverage", label: "掲載媒体の網羅", default_tier: "A" },
    { key: "strength_message_clarity", label: "特徴・強みの伝わりやすさ", default_tier: "B" },
    { key: "review_tendency", label: "口コミ傾向", default_tier: "A" },
    { key: "negative_reviews", label: "ネガティブ・ギャップのある口コミ", default_tier: "A" },
    { key: "usage_concept_gap", label: "使われ方とコンセプトのズレ", default_tier: "B" },
    { key: "appeal_gap", label: "魅力の伝わり方の伸びしろ", default_tier: "B" },
  ],
  category_6_competitor: [
    { key: "reservation_tool", label: "予約ツール・方法", default_tier: "A" },
    { key: "reservation_volume_gap", label: "予約数・客数の過不足", default_tier: "C" },
    { key: "main_reservation_channel", label: "主要予約経路", default_tier: "C" },
    { key: "seat_utilization", label: "客席稼働率・回転率", default_tier: "C" },
    { key: "revenue", label: "売上高", default_tier: "C" },
    { key: "current_media_and_cost", label: "使用中ネット媒体・コスト", default_tier: "C" },
    { key: "current_growth_actions", label: "伸びしろに対する現在の対策", default_tier: "C" },
    { key: "management_summary", label: "経営陣の総括", default_tier: "C" },
  ],
  category_7_owned_media: [
    { key: "official_site", label: "公式サイト有無", default_tier: "A" },
    { key: "sns_accounts", label: "各種 SNS アカウント有無", default_tier: "A" },
    { key: "sns_update_frequency", label: "SNS 更新頻度", default_tier: "A" },
    { key: "other_owned_outreach", label: "その他自店発信", default_tier: "A" },
  ],
  category_8_other: [
    { key: "future_goals", label: "今後の目標", default_tier: "C" },
    { key: "top_priority_issue", label: "最優先課題", default_tier: "C" },
  ],
};

/** 全項目フラット配列。プロンプト構築・UI 凡例での反復で使用。 */
export const DEEP_RESEARCH_ITEMS_FLAT: ReadonlyArray<
  DeepResearchItemKey & { category: CategoryKey }
> = (Object.entries(DEEP_RESEARCH_ITEMS) as [CategoryKey, DeepResearchItemKey[]][])
  .flatMap(([category, items]) =>
    items.map((item) => ({ ...item, category })),
  );

/** 全項目総数 (51 項目想定、Issue #43 §2 集計値)。 */
export const TOTAL_ITEM_COUNT = DEEP_RESEARCH_ITEMS_FLAT.length;
