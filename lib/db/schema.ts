import { pgTable, text, integer, real, index } from "drizzle-orm/pg-core";

/**
 * stores テーブル
 *
 * `types/store.ts` の `Store` インタフェースと 1:1 で対応します。
 *
 * - 主キー `id` は `<entity>_<id>` 形式の text を継続使用 (Req 10.1)
 * - `created_at` / `updated_at` は `YYYY-MM-DD` 形式の text として保持 (Req 10.2)
 * - 列挙型 (`Priority` / `StageId` / `Channel` / `ContactForm`) は Postgres ENUM 化せず
 *   text として保持し、値の妥当性は Action 層 / TS 型ガードに委譲します
 */
export const stores = pgTable("stores", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  prefecture: text("prefecture").notNull(),
  city: text("city").notNull(),
  address: text("address").notNull(),
  genre: text("genre").notNull(),
  priority: text("priority").notNull(),
  stage: text("stage").notNull(),
  channel: text("channel").notNull(),
  has_contact_form: text("has_contact_form").notNull(),
  map_url: text("map_url").notNull(),
  site_url: text("site_url").notNull(),
  instagram_url: text("instagram_url").notNull(),
  phone: text("phone").notNull(),
  target_service: text("target_service").notNull(),
  review_count: integer("review_count").notNull(),
  review_avg: real("review_avg").notNull(),
  memo: text("memo").notNull(),
  assigned_planner: text("assigned_planner").notNull(),
  assigned_sales: text("assigned_sales").notNull(),
  /** 運営者種別 (個人店 / 複数店舗運営 / 未設定)。既存レコードは "未設定" にフォールバック。 */
  operator_type: text("operator_type").notNull().default("未設定"),
  /** 運営者名 (法人名 or 個人オーナー名)。空文字許容、デフォルト空文字。 */
  operator_name: text("operator_name").notNull().default(""),
  /** AI 分析結果の JSON 文字列 (`AiAnalysisResult` を JSON.stringify)。未分析時は NULL。 */
  ai_analysis_result: text("ai_analysis_result"),
  /** 緯度。エリア検索 / Google Map 埋め込み用。未取得時は NULL。 */
  lat: real("lat"),
  /** 経度。エリア検索 / Google Map 埋め込み用。未取得時は NULL。 */
  lng: real("lng"),
  /** 営業時間。フリーテキスト(例: "11:00-23:00 / 日休")、未入力時は空文字。 */
  business_hours: text("business_hours").notNull().default(""),
  /** Google Places ID。エリア検索経由で登録した店舗のみ格納。手動登録時は NULL。 */
  google_place_id: text("google_place_id"),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
}, (table) => [
  index("stores_google_place_id_idx").on(table.google_place_id),
]);

/**
 * deals テーブル
 *
 * `types/deal.ts` の `Deal` インタフェースと 1:1 で対応します。
 *
 * - `store_id` は `stores.id` への外部キー制約を持ち、不存在 store_id への Deal 作成を
 *   DB レベルで拒否します (Req 10.3)
 * - `order_amount` のみ nullable で、それ以外のカラムは NOT NULL を基本とします
 * - 列挙型 (`MeetingType` / `DealStatus`) は Postgres ENUM 化せず text として保持します
 */
export const deals = pgTable("deals", {
  id: text("id").primaryKey(),
  store_id: text("store_id")
    .notNull()
    .references(() => stores.id),
  store_name: text("store_name").notNull(),
  date: text("date").notNull(),
  meeting_type: text("meeting_type").notNull(),
  discussion: text("discussion").notNull(),
  proposal: text("proposal").notNull(),
  estimate_amount: integer("estimate_amount").notNull(),
  order_amount: integer("order_amount"),
  lost_reason: text("lost_reason").notNull(),
  status: text("status").notNull(),
  assigned_sales: text("assigned_sales").notNull(),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
});

/**
 * research テーブル
 *
 * `types/research.ts` の `Research` インタフェースと 1:1 で対応します。
 *
 * - `store_id` は `stores.id` への外部キー制約を持ち、不存在 store_id への Research 作成を
 *   DB レベルで拒否します (Req 2.5, 10.5)
 * - 1 店舗 1 調査 (1:1) はアプリ層で担保。DB レベルの UNIQUE 制約は付けず、
 *   Mock 慣習との整合と import 時のエラー設計回避を優先します (research-handoff-db-migration design Q1)
 * - 列挙型 (`Channel` / `ResearchStatus`) は Postgres ENUM 化せず text として保持します
 * - `created_at` / `updated_at` は `YYYY-MM-DD` 形式の text として保持 (Req 10.2)
 */
export const research = pgTable("research", {
  id: text("id").primaryKey(),
  store_id: text("store_id")
    .notNull()
    .references(() => stores.id),
  store_name: text("store_name").notNull(),
  total_review: text("total_review").notNull(),
  strength1: text("strength1").notNull(),
  strength2: text("strength2").notNull(),
  strength3: text("strength3").notNull(),
  weakness1: text("weakness1").notNull(),
  weakness2: text("weakness2").notNull(),
  weakness3: text("weakness3").notNull(),
  review_positive: text("review_positive").notNull(),
  review_negative: text("review_negative").notNull(),
  meo_gap: text("meo_gap").notNull(),
  hp_gap: text("hp_gap").notNull(),
  instagram_gap: text("instagram_gap").notNull(),
  channel: text("channel").notNull(),
  channel_reason: text("channel_reason").notNull(),
  sales_hook: text("sales_hook").notNull(),
  entry_product: text("entry_product").notNull(),
  main_product: text("main_product").notNull(),
  researcher: text("researcher").notNull(),
  status: text("status").notNull(),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
});

/**
 * handoffs テーブル
 *
 * `types/handoff.ts` の `Handoff` インタフェースと 1:1 で対応します。
 *
 * - `store_id` は `stores.id` への外部キー制約 (Req 3.8, 10.5)
 * - `deal_id` は `deals.id` への外部キー制約 (Req 3.8, 10.5)
 * - `payment_confirmed` のみ nullable text。未確認状態を `null` で表現可能 (Req 10.3)
 * - その他のカラムは NOT NULL を基本とし、列挙型 (`HandoffStatus`) は text として保持します
 */
export const handoffs = pgTable("handoffs", {
  id: text("id").primaryKey(),
  store_id: text("store_id")
    .notNull()
    .references(() => stores.id),
  store_name: text("store_name").notNull(),
  deal_id: text("deal_id")
    .notNull()
    .references(() => deals.id),
  contract_services: text("contract_services").notNull(),
  initial_fee: integer("initial_fee").notNull(),
  monthly_fee: integer("monthly_fee").notNull(),
  contract_period: text("contract_period").notNull(),
  expected_result: text("expected_result").notNull(),
  contract_owner: text("contract_owner").notNull(),
  caution: text("caution").notNull(),
  ng_items: text("ng_items").notNull(),
  due_date: text("due_date").notNull(),
  materials_status: text("materials_status").notNull(),
  ops_assignee: text("ops_assignee").notNull(),
  contract_date: text("contract_date").notNull(),
  payment_confirmed: text("payment_confirmed"),
  status: text("status").notNull(),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
});
