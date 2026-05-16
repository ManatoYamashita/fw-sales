import { pgTable, text, integer, real, uuid } from "drizzle-orm/pg-core";

/**
 * profiles テーブル (auth-and-notifications spec, Issue #16)
 *
 * `auth.users` (Supabase 管理スキーマ) と 1:1 対応するアプリ側プロフィール。
 *
 * - `id` は uuid PK、`auth.users.id` への FK 制約 (ON DELETE CASCADE) を
 *   マイグレーション側で raw SQL で付与する (cross-schema FK は drizzle 表現外)
 * - `auth.users` への INSERT は `handle_new_user()` trigger により本テーブルへ
 *   自動展開される (Req 2.1, 2.2)
 * - `email` は UNIQUE 制約付き、placeholder の場合は `placeholder-{slug}@local.invalid`
 * - `created_at` / `updated_at` は既存規約に従い `YYYY-MM-DD` 形式 text を継続使用
 */
export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull().unique(),
  display_name: text("display_name").notNull(),
  avatar_url: text("avatar_url"),
  /** `'member' | 'placeholder'` のいずれか。アプリ層型ガードで担保 (既存規約) */
  role: text("role").notNull().default("member"),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
});

/**
 * notifications テーブル (auth-and-notifications spec, Issue #16)
 *
 * テーブル本体および UI (通知ベル) は別仕様 (#14) が所有。本仕様では
 * `user_id` 列の追加と「ベルが本人通知のみ表示する」契約を提供する。
 *
 * - `id` は text PK (`<entity>_<id>` 形式の既存規約に揃える)
 * - `user_id` は nullable uuid → `profiles.id` への FK (Req 7.1, 7.2, 7.3)
 *   NULL は「全員向け通知」として将来拡張余地を残す
 * - `kind` は text + アプリ層型ガード (`NotificationKind` 型) で担保
 * - `read_at` は既読時刻 (NULL = 未読)
 *
 * 注: `#14` がこのテーブルを正式新設する場合は、本仕様の定義は #14 の最終形に
 * 整合させる (本仕様 §Boundary Commitments)。
 */
export const notifications = pgTable("notifications", {
  id: text("id").primaryKey(),
  /**
   * 通知受信者の profile.id (uuid)。
   * Phase 10 (0006 マイグレーション) で `profiles.id` への FK 制約を追加。
   * `null` は「全員宛 / システム通知」用に予約 (#14 通知ベル UI が解釈)。
   */
  user_id: uuid("user_id").references(() => profiles.id),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  link_url: text("link_url"),
  read_at: text("read_at"),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
});

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
  /**
   * 企画担当ユーザーへの参照 (auth-and-notifications spec)。
   * `profiles.id` への uuid FK (nullable)。
   * Phase 8 (0005 マイグレーション) で旧 `assigned_planner` (text) を DROP し、本列が単一の真実となった。
   */
  assigned_planner_user_id: uuid("assigned_planner_user_id").references(
    () => profiles.id,
  ),
  /**
   * 営業担当ユーザーへの参照 (auth-and-notifications spec)。
   * `profiles.id` への uuid FK (nullable)。
   * Phase 8 で旧 `assigned_sales` (text) DROP 済。本列が単一の真実。
   */
  assigned_sales_user_id: uuid("assigned_sales_user_id").references(
    () => profiles.id,
  ),
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
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
});

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
  /**
   * 営業担当ユーザーへの参照 (auth-and-notifications spec)。
   * `profiles.id` への uuid FK (nullable)。
   * Phase 8 で旧 `assigned_sales` (text) DROP 済。本列が単一の真実。
   */
  assigned_sales_user_id: uuid("assigned_sales_user_id").references(
    () => profiles.id,
  ),
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
