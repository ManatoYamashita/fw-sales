/**
 * 基本情報 50 項目の定義表 (store-basic-info / Issue #114, #121)
 *
 * 各店舗の `basic_info`(8 カテゴリ・50 項目)の正規化キーマップ。各項目の
 * キー・ラベル・カテゴリ・既定取得区分(tier)・優先ソース(primary)を単一の真実として
 * 保持する。`types/basic-info.ts` の `BasicInfo` のキー集合はここが規定する。
 *
 * 項目数について:
 * - 原典 Issue #43 §2 の 8 カテゴリテーブルを全項目照合した結果、**実体は 50 項目**。
 *   #43 タイトル/見出し/集計の「51」は起票時の集計誤記であり、原典に 51 番目の項目は
 *   存在しない。よって本表は原典準拠の 50 項目で確定する(`TOTAL_BASIC_INFO_ITEMS` は
 *   定義から動的算出するため、表記と実数が乖離しない)。
 *
 * 依存方向について:
 * - `lib/domain` は `lib/ai` を import しない(逆流禁止)。`lib/ai/deep-research/schema.ts`
 *   の `DEEP_RESEARCH_ITEMS`(構造化 spec 用、#110/#121 で撤去予定)に依存せず、その内容を
 *   母体に**独立定義**する。これにより構造化資産の撤去後も本表は独立して残る。
 *
 * primary(優先ソース)について:
 * - #121 で AI 構造化充填を撤去したため、充填ソースは `places`(エリア検索) / `manual`(手動)
 *   の 2 系統。Places(公開地図情報)が主ソースとして妥当な項目を `places`、それ以外を
 *   `manual` とする。`places` 非対応項目は手動入力または未充足のまま、生成時は貼付テキストが
 *   文脈を補う(design.md §Data Models)。
 *
 * 関連: design.md §Data Models / requirements.md §2.1 §2.2 §5.2
 */

import type { FillSource } from "@/types/basic-info";

/** 取得難易度区分。A: 高信頼取得 / B: 推定(確信度必須) / C: 店主ヒアリング必須。 */
export type DifficultyTier = "A" | "B" | "C";

/** 8 カテゴリのキーと表示ラベル。UI 凡例・カテゴリ見出しで参照する。 */
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

/** 基本情報 1 項目の定義(値ではなくスキーマ)。`BasicInfoField` の値はここでは持たない。 */
export interface BasicInfoItemDef {
  key: string;
  label: string;
  category: CategoryKey;
  default_tier: DifficultyTier;
  /** 競合解決の優先ソース。Places が主ソースとして妥当な項目のみ "places"。 */
  primary: FillSource;
}

/**
 * 8 カテゴリ・50 項目の定義表(原典 #43 §2 と一致)。
 *
 * primary="places"(7 項目): Places(公開地図情報)が主ソースとして妥当な
 * store_name / address / cuisine_genre / business_hours_holidays / official_site /
 * location_feature / nearest_station(design.md の Places 直結例示)。残り 43 項目は "manual"。
 */
export const BASIC_INFO_ITEMS: readonly BasicInfoItemDef[] = [
  // category_1_basic (13)
  { key: "store_name", label: "屋号", category: "category_1_basic", default_tier: "A", primary: "places" },
  { key: "address", label: "住所", category: "category_1_basic", default_tier: "A", primary: "places" },
  { key: "opening_date", label: "オープン日（創業年数）", category: "category_1_basic", default_tier: "B", primary: "manual" },
  { key: "business_hours_holidays", label: "営業時間・定休日", category: "category_1_basic", default_tier: "A", primary: "places" },
  { key: "average_spend_day_night", label: "客単価（昼・夜）", category: "category_1_basic", default_tier: "B", primary: "manual" },
  { key: "seat_count", label: "席数", category: "category_1_basic", default_tier: "B", primary: "manual" },
  { key: "cuisine_genre", label: "料理ジャンル（業種）", category: "category_1_basic", default_tier: "A", primary: "places" },
  { key: "concept", label: "お店のコンセプト・特徴", category: "category_1_basic", default_tier: "B", primary: "manual" },
  { key: "signature_food_drink", label: "料理・酒の特徴（名物等）", category: "category_1_basic", default_tier: "B", primary: "manual" },
  { key: "exterior_interior", label: "外観・内観の特徴", category: "category_1_basic", default_tier: "B", primary: "manual" },
  { key: "alacarte_course", label: "アラカルト・コースの特徴", category: "category_1_basic", default_tier: "B", primary: "manual" },
  { key: "main_target", label: "メインターゲット", category: "category_1_basic", default_tier: "B", primary: "manual" },
  { key: "operation_style", label: "オペレーションの特徴", category: "category_1_basic", default_tier: "C", primary: "manual" },

  // category_2_owner (6) — 立地環境・商圏データ
  { key: "location_feature", label: "立地の特徴", category: "category_2_owner", default_tier: "A", primary: "places" },
  { key: "nearest_station", label: "最寄り駅・距離・乗降客数", category: "category_2_owner", default_tier: "A", primary: "places" },
  { key: "floor_level", label: "階層", category: "category_2_owner", default_tier: "B", primary: "manual" },
  { key: "trade_area", label: "周辺商圏の特徴", category: "category_2_owner", default_tier: "A", primary: "manual" },
  { key: "population_day_night", label: "店舗周辺人口（昼夜）", category: "category_2_owner", default_tier: "A", primary: "manual" },
  { key: "visit_method", label: "主要な来店手段", category: "category_2_owner", default_tier: "B", primary: "manual" },

  // category_3_menu (4) — 店主のプロフィール・想い
  { key: "owner_profile", label: "店主基本情報", category: "category_3_menu", default_tier: "C", primary: "manual" },
  { key: "owner_career", label: "経歴・修行先", category: "category_3_menu", default_tier: "C", primary: "manual" },
  { key: "owner_philosophy", label: "店主の想い", category: "category_3_menu", default_tier: "C", primary: "manual" },
  { key: "owner_sns", label: "店主個人 SNS", category: "category_3_menu", default_tier: "A", primary: "manual" },

  // category_4_customer (7) — 市場環境・ネット露出・認知度
  { key: "competitor_stores", label: "商圏内ライバル店舗（最低2件）", category: "category_4_customer", default_tier: "A", primary: "manual" },
  { key: "competitor_benchmark", label: "ライバル店ベンチマーク", category: "category_4_customer", default_tier: "A", primary: "manual" },
  { key: "competitor_paid_ads", label: "ライバル有料広告活用有無", category: "category_4_customer", default_tier: "B", primary: "manual" },
  { key: "own_net_exposure", label: "自店のネット露出状況", category: "category_4_customer", default_tier: "A", primary: "manual" },
  { key: "search_volume", label: "認知数（屋号月間検索ボリューム）", category: "category_4_customer", default_tier: "B", primary: "manual" },
  { key: "market_demand", label: "市場需要", category: "category_4_customer", default_tier: "B", primary: "manual" },
  { key: "exposure_gap", label: "露出の過不足・伸びしろ", category: "category_4_customer", default_tier: "B", primary: "manual" },

  // category_5_marketing (6) — 認知の質・ブランドイメージ
  { key: "media_coverage", label: "掲載媒体の網羅", category: "category_5_marketing", default_tier: "A", primary: "manual" },
  { key: "strength_message_clarity", label: "特徴・強みの伝わりやすさ", category: "category_5_marketing", default_tier: "B", primary: "manual" },
  { key: "review_tendency", label: "口コミ傾向", category: "category_5_marketing", default_tier: "A", primary: "manual" },
  { key: "negative_reviews", label: "ネガティブ・ギャップのある口コミ", category: "category_5_marketing", default_tier: "A", primary: "manual" },
  { key: "usage_concept_gap", label: "使われ方とコンセプトのズレ", category: "category_5_marketing", default_tier: "B", primary: "manual" },
  { key: "appeal_gap", label: "魅力の伝わり方の伸びしろ", category: "category_5_marketing", default_tier: "B", primary: "manual" },

  // category_6_competitor (8) — 予約・集客・売上・経営状況
  { key: "reservation_tool", label: "予約ツール・方法", category: "category_6_competitor", default_tier: "A", primary: "manual" },
  { key: "reservation_volume_gap", label: "予約数・客数の過不足", category: "category_6_competitor", default_tier: "C", primary: "manual" },
  { key: "main_reservation_channel", label: "主要予約経路", category: "category_6_competitor", default_tier: "C", primary: "manual" },
  { key: "seat_utilization", label: "客席稼働率・回転率", category: "category_6_competitor", default_tier: "C", primary: "manual" },
  { key: "revenue", label: "売上高", category: "category_6_competitor", default_tier: "C", primary: "manual" },
  { key: "current_media_and_cost", label: "使用中ネット媒体・コスト", category: "category_6_competitor", default_tier: "C", primary: "manual" },
  { key: "current_growth_actions", label: "伸びしろに対する現在の対策", category: "category_6_competitor", default_tier: "C", primary: "manual" },
  { key: "management_summary", label: "経営陣の総括", category: "category_6_competitor", default_tier: "C", primary: "manual" },

  // category_7_owned_media (4) — 公式サイト・自社発信
  { key: "official_site", label: "公式サイト有無", category: "category_7_owned_media", default_tier: "A", primary: "places" },
  { key: "sns_accounts", label: "各種 SNS アカウント有無", category: "category_7_owned_media", default_tier: "A", primary: "manual" },
  { key: "sns_update_frequency", label: "SNS 更新頻度", category: "category_7_owned_media", default_tier: "A", primary: "manual" },
  { key: "other_owned_outreach", label: "その他自店発信", category: "category_7_owned_media", default_tier: "A", primary: "manual" },

  // category_8_other (2) — 今後の目標・お困り事
  { key: "future_goals", label: "今後の目標", category: "category_8_other", default_tier: "C", primary: "manual" },
  { key: "top_priority_issue", label: "最優先課題", category: "category_8_other", default_tier: "C", primary: "manual" },
] as const;

/** 全項目総数。定義から動的算出するため表記と実数が乖離しない(原典準拠 = 50)。 */
export const TOTAL_BASIC_INFO_ITEMS = BASIC_INFO_ITEMS.length;

/** key → 定義 の逆引きマップ。マージ・変換・表示での参照に使う。 */
export const BASIC_INFO_ITEM_BY_KEY: ReadonlyMap<string, BasicInfoItemDef> =
  new Map(BASIC_INFO_ITEMS.map((item) => [item.key, item]));
