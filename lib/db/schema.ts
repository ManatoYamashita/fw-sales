import {
  pgTable,
  text,
  integer,
  real,
  index,
  uuid,
  uniqueIndex,
  timestamp,
  jsonb,
  numeric,
  boolean,
} from "drizzle-orm/pg-core";

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
/**
 * research_jobs テーブル (deep-research-pipeline spec, Issue #43)
 *
 * Deep Research ジョブのライフサイクル (`queued` / `researching` / `structuring`
 * / `done` / `failed`) を保持する単一の真実。本 spec の同期/非同期処理の
 * Single Source of Truth (design.md §Physical Data Model)。
 *
 * - `id` は `<entity>_<id>` 形式の text PK (`job_<nanoid>`)
 * - `status` は text + アプリ層 `JobStatus` 型ガードで担保 (既存規約踏襲)
 * - 時刻列は秒精度が必要なため `timestamptz` を採用 (既存 text date 列とは別系統)
 * - `error_log` は `{ stage, kind, message, occurredAt, cancel_result? }` の配列を jsonb で
 * - 失敗ジョブからの再投入は元行を touch せず新規行を作る方針 (R5.6, design.md §State Machine)
 *
 * 関連: design.md §Physical Data Model / research_jobs, requirements.md
 *       §1.1, §1.2, §2.3, §5.3, §5.4, §8.1, §8.3, §8.4
 */
export const researchJobs = pgTable(
  "research_jobs",
  {
    id: text("id").primaryKey(),
    store_id: text("store_id")
      .notNull()
      .references(() => stores.id),
    user_id: uuid("user_id")
      .notNull()
      .references(() => profiles.id),
    /**
     * 列挙値: `queued` / `researching` / `structuring` / `done` / `failed`
     * (`types/deep-research.ts` の `JobStatus` 型で担保)。
     */
    status: text("status").notNull().default("queued"),
    /** Stage 1 (Deep Research) のタスク識別子 (`interactions/...`)。Stage 1 起動時に書込。 */
    deep_research_task_id: text("deep_research_task_id"),
    /** Stage 1 起動回数 (sweep / cancel 後の手動再投入は新規行のため、ここでは増えない)。 */
    attempts: integer("attempts").notNull().default(0),
    /**
     * 失敗・スタック理由のジョブログ。配列要素 shape:
     * `{ stage: "stage1"|"stage2"|"sweep", kind: string, message: string,
     *    occurred_at: ISO 8601 文字列, cancel_result?: object }`
     */
    error_log: jsonb("error_log"),
    enqueued_at: timestamp("enqueued_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    research_started_at: timestamp("research_started_at", {
      withTimezone: true,
    }),
    research_completed_at: timestamp("research_completed_at", {
      withTimezone: true,
    }),
    completed_at: timestamp("completed_at", { withTimezone: true }),
    /** Google API の Interaction.updated 値。cron poll 時に毎回上書き。 */
    api_updated_at: timestamp("api_updated_at", { withTimezone: true }),
    /** Stage 1 (Deep Research) 完了時の生 Markdown レポート。Stage 2 構造化に使用。 */
    stage1_markdown: text("stage1_markdown"),
    /** Stage 1 (Deep Research) 完了時の引用 URL 配列。Stage 2 構造化に使用。 */
    stage1_source_urls: jsonb("stage1_source_urls"),
  },
  (table) => [
    index("research_jobs_status_enqueued_idx").on(
      table.status,
      table.enqueued_at,
    ),
    index("research_jobs_store_idx").on(table.store_id),
    index("research_jobs_user_enqueued_idx").on(table.user_id, table.enqueued_at),
    index("research_jobs_enqueued_idx").on(table.enqueued_at),
  ],
);

/**
 * research_reports テーブル (deep-research-pipeline spec, Issue #43)
 *
 * Deep Research の最終成果物。1 成功ジョブにつき 1 行 (`UNIQUE (job_id)`)。
 *
 * - `id` は `report_<nanoid>` text PK
 * - 8 カテゴリは個別 jsonb 列、各内部は `DeepResearchItem` の配列 (`types/deep-research.ts`)
 * - `total_cost_yen` は SDK が token usage を出さない場合 NULL 許容 (Phase 0 PoC で確定)
 * - `total_duration_sec` は `completed_at - research_started_at` の秒数
 *
 * 関連: design.md §Physical Data Model / research_reports, requirements.md
 *       §3.1, §3.2, §3.3, §3.4, §3.5, §3.6, §8.1
 */
export const researchReports = pgTable(
  "research_reports",
  {
    id: text("id").primaryKey(),
    job_id: text("job_id")
      .notNull()
      .references(() => researchJobs.id),
    store_id: text("store_id")
      .notNull()
      .references(() => stores.id),
    category_1_basic: jsonb("category_1_basic").notNull().default([]),
    category_2_owner: jsonb("category_2_owner").notNull().default([]),
    category_3_menu: jsonb("category_3_menu").notNull().default([]),
    category_4_customer: jsonb("category_4_customer").notNull().default([]),
    category_5_marketing: jsonb("category_5_marketing").notNull().default([]),
    category_6_competitor: jsonb("category_6_competitor").notNull().default([]),
    category_7_owned_media: jsonb("category_7_owned_media")
      .notNull()
      .default([]),
    category_8_other: jsonb("category_8_other").notNull().default([]),
    /** C 区分項目から抽出したヒアリング質問の配列: `{ category, question }[]` */
    hearing_questions: jsonb("hearing_questions").notNull().default([]),
    /** Stage 1 が返した生 Markdown 全文 (原典として保持、再構造化のソースにも) */
    full_markdown: text("full_markdown").notNull(),
    /** Stage 1 が引用した URL の重複排除済配列 */
    all_source_urls: jsonb("all_source_urls").notNull().default([]),
    total_cost_yen: numeric("total_cost_yen", { precision: 10, scale: 2 }),
    total_duration_sec: integer("total_duration_sec").notNull().default(0),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("research_reports_job_idx").on(table.job_id),
    index("research_reports_store_created_idx").on(
      table.store_id,
      table.created_at,
    ),
  ],
);

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

/**
 * ai_prompt_templates テーブル (Issue #42)
 *
 * 各ユーザーが保持する Gemini プロンプトの Few-shot テンプレート。
 *
 * - `id` は uuid PK、`gen_random_uuid()` で自動生成 (`.defaultRandom()`)
 * - `user_id` は `profiles.id` への FK (ON DELETE CASCADE)
 * - `body` は `{ fewshots: FewShotExample[] }` を JSON 文字列として格納 (既存 ai_analysis_result 規約に揃える)
 * - `is_default` = true の partial unique index は migration 0009 で raw SQL として追加
 *   (Drizzle ORM が partial unique index の WHERE 句を直接サポートしないため)
 * - デフォルトテンプレート削除拒否は migration 0009 の DB trigger で保証
 * - `created_at` / `updated_at` は `YYYY-MM-DD` 形式 text (既存規約に揃える)
 * - RLS は Supabase 側で別途管理 (既存プロジェクトの規約に従う)
 *
 * 関連: Issue #42, drizzle/0009_add_ai_prompt_templates.sql
 */
export const aiPromptTemplates = pgTable(
  "ai_prompt_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    is_default: boolean("is_default").notNull().default(false),
    /** JSON 文字列: `{ fewshots: FewShotExample[] }` */
    body: text("body").notNull(),
    created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull(),
  },
  (table) => [
    index("ai_prompt_templates_user_idx").on(table.user_id),
    // partial unique index (WHERE is_default = true) は migration 0009 に raw SQL で追加
  ],
);
