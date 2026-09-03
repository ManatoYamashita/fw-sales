import {
  pgTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
  uuid,
  jsonb,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import type { BasicInfo } from "@/types/basic-info";
import type {
  ResearchItem,
  SourceRegistryEntry,
  ReviewDecisions,
} from "@/types/research-run";

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
  /** Google Places ID。エリア検索経由で登録した店舗のみ格納。手動登録時は NULL。 */
  google_place_id: text("google_place_id"),
  /** アポ取得日 (`YYYY-MM-DD`)。NULL = 未取得。取得済み/未取得は本列の有無から導出する。 */
  appointment_acquired_date: text("appointment_acquired_date"),
  /** 次回アクション予定日 (`YYYY-MM-DD`)。NULL = 未設定。 */
  next_action_date: text("next_action_date"),
  /** 次回アクション内容 (500 文字以内は Action 層で担保)。NULL = 未設定。 */
  next_action_note: text("next_action_note"),
  /**
   * 基本情報 50 項目 (store-basic-info / Issue #114, #121)。
   * キーは `BASIC_INFO_ITEMS` (`lib/domain/basic-info-items.ts`)、値は `BasicInfoField`。
   * 未充足項目も枠として保持し、Places / 手動で段階充填する。既定は空オブジェクト
   * (店舗名のみで登録可)。読み取りは basic_info 優先 + 既存スカラー fallback (PR1)。
   */
  basic_info: jsonb("basic_info").$type<BasicInfo>().notNull().default({}),
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
    .references(() => stores.id, { onDelete: "cascade" }),
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
  /** 日付単位の営業メモ。 */
  activity_memo: text("activity_memo"),
  /** 当該記録時点で設定した次回アクション。 */
  next_action_date: text("next_action_date"),
  next_action_type: text("next_action_type"),
  next_action_note: text("next_action_note"),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
}, (table) => [
  // store-cascade-delete (#152): FK 列インデックス。cascade 削除の子走査と
  // 削除影響カウント (getDeleteImpact) の seq scan を回避する。
  index("deals_store_id_idx").on(table.store_id),
]);

/**
 * research テーブル (旧・手入力の調査フォーム)
 *
 * **Issue #110 で撤去予定。本定義は物理 DROP を行う後続 PR まで残す暫定状態です。**
 * アプリケーションコードからの参照は既にゼロで、書き込み経路 (`saveResearchAction`)
 * も読み出し経路 (`getResearchByStore` / `repos.research.list`) も撤去済み。
 * ここに定義が残っているのは、`pnpm db:generate` が `drizzle/meta/` の最新
 * snapshot との差分から DROP TABLE migration を生成する必要があるためであり、
 * schema 変更と生成物を同一 PR に閉じて再現性を保つ意図です。
 * 現行の店舗調査は `storeResearchRuns` (AI 店舗調査 / Plan v3.2) が担当します。
 *
 * 旧 `types/research.ts` の `Research` インタフェースと 1:1 で対応していました。
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
    .references(() => stores.id, { onDelete: "cascade" }),
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
}, (table) => [
  // store-cascade-delete (#152): FK 列インデックス (deals_store_id_idx と同趣旨)。
  index("research_store_id_idx").on(table.store_id),
]);

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
// task 4.2 (PR3a): researchJobs / researchReports テーブル定義を撤去 (#121 / #110 連動)。
// 物理 DROP は drizzle migration 0017 で実施。

export const handoffs = pgTable("handoffs", {
  id: text("id").primaryKey(),
  store_id: text("store_id")
    .notNull()
    .references(() => stores.id, { onDelete: "cascade" }),
  store_name: text("store_name").notNull(),
  deal_id: text("deal_id")
    .notNull()
    .references(() => deals.id, { onDelete: "cascade" }),
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
}, (table) => [
  // store-cascade-delete (#152): FK 列インデックス (deals_store_id_idx と同趣旨)。
  // deal_id は deals 削除の cascade 走査も受けるため両列に張る。
  index("handoffs_store_id_idx").on(table.store_id),
  index("handoffs_deal_id_idx").on(table.deal_id),
]);

/**
 * ai_prompt_templates テーブル (Issue #42)
 *
 * 各ユーザーが保持する Gemini プロンプトの Few-shot テンプレート。
 *
 * - `id` は uuid PK、`gen_random_uuid()` で自動生成 (`.defaultRandom()`)
 * - `user_id` は `profiles.id` への FK (ON DELETE CASCADE)
 * - `body` は `{ fewshots: FewShotExample[] }` を JSON 文字列として格納 (既存 ai_analysis_result 規約に揃える)
 * - `is_default` = true の partial unique index は migration 0010 で raw SQL として追加
 *   (下記「partial index と Drizzle」を参照)
 * - デフォルトテンプレート削除拒否は migration 0010 の DB trigger で保証
 * - `created_at` / `updated_at` は `YYYY-MM-DD` 形式 text (既存規約に揃える)
 * - RLS は Supabase 側で別途管理 (既存プロジェクトの規約に従う)
 *
 * ## partial index と Drizzle
 *
 * 本 JSDoc は当初「Drizzle ORM が partial unique index の WHERE 句を直接サポートしない」と
 * 記載していたが、**現行の drizzle-orm では誤り**である。`IndexBuilder` は `.where(condition: SQL)`
 * を持ち (`node_modules/drizzle-orm/pg-core/indexes.d.ts`)、`index()` / `uniqueIndex()` の
 * どちらからでも `uniqueIndex("...").on(table.user_id).where(sql`...`)` と表現できる。
 * raw SQL で持っているのは 0010 作成当時の制約に由来する歴史的経緯であり、現在の制約ではない。
 *
 * ただし **schema.ts 側へ移す場合は snapshot との同期に注意**すること。
 * `ai_prompt_templates_default_idx` は drizzle の snapshot に載っておらず
 * (`drizzle/meta/*_snapshot.json` の indexes は `ai_prompt_templates_user_idx` のみ)、
 * schema.ts に宣言を足すと `pnpm db:generate` が「DB に無い index」とみなして
 * 重複した `CREATE UNIQUE INDEX` を生成する。移行するなら生成物の確認が必須。
 * 現状は動作しているため、本コミットでは記述の訂正のみを行い宣言は移していない。
 *
 * 関連: Issue #42, drizzle/0010_add_ai_prompt_templates.sql
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
    // partial unique index (WHERE is_default = true) は migration 0010 に raw SQL で追加。
    // Drizzle でも .where() で表現できるが snapshot 未登録のため移行には注意 (上の JSDoc 参照)
  ],
);

/**
 * app_settings テーブル (store-flow-guidance / Issue #122)
 *
 * アプリ全体の設定をキー・バリュー形式で保持する汎用テーブル。
 *
 * - `key` は設定キー (PK)。`value` は文字列値 (URL 等)。
 * - `updated_at` は既存規約に従い `YYYY-MM-DD` 形式 text。
 * - 全社共通の単一値を想定 (user 別ではない)。user/組織別が必要になればキー設計を拡張。
 *
 * ## 現在アプリから読み書きしているキーは無い
 *
 * 唯一の利用者だった調査用 Gem の URL (`deep_research_gem_url`) は、それを開く
 * ワークベンチ STEP0 (`research-prompt-step.tsx`) が PR #180 で削除されたことにより
 * 「設定できるが誰も読まない」孤児設定になっていたため、設定 UI ごと撤去した。
 *
 * **それでもテーブルと `appSettings` 定義は残す**:
 *
 * 1. `.github/workflows/supabase-keepalive.yml` が Supabase の自動停止を防ぐため
 *    `select count(*) from app_settings` を実テーブルへ投げている
 * 2. schema からこの定義を消すと `drizzle-kit` が **DROP TABLE の migration を
 *    生成しようとする**。テーブルを残す以上、定義も残さなければならない
 *
 * `repos.appSettings` / `CACHE_TAGS.appSettings` も同じ理由で残置している
 * (現在の呼び出し元は無いが、汎用 KV テーブルに対する薄いアクセサであり、
 * 次に設定項目を足すときの接続点になる)。
 *
 * 関連: Issue #122, drizzle/0019_add_app_settings.sql
 */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updated_at: text("updated_at").notNull(),
});

/**
 * place_candidates テーブル (エリア検索 候補DB保存の土台 / Issue #129 follow-up)
 *
 * エリア検索 (Text Search / もっと読み込み / 追加探索 / Nearby深掘り) で見つかった
 * 候補を `google_place_id` 単位で蓄積する。将来の「前回候補の再利用」「有力候補判定」
 * 等の土台であり、本テーブル自体の一覧表示・再利用は別実装とする。
 *
 * - `id` は `<entity>_<id>` 形式の text PK (既存規約)
 * - `google_place_id` は UNIQUE。同じ候補は1レコードに統合し、`seen_count` を加算する
 * - `status` は `'candidate' | 'added' | 'ignored' | 'stale'` (`PlaceCandidateStatus`)。
 *   Postgres ENUM 化せず text として保持し、値の妥当性は repository / TS 型で担保する
 * - `discovery_sources` は `AreaSearchDiscoverySource[]` を jsonb 配列として保持する
 *   (`basic_info` の jsonb 規約に揃える)
 * - 規約上の理由 (Google Places利用規約) により、店舗名・住所・評価・電話番号等の
 *   Google由来コンテンツは保存しない。保存対象は `google_place_id` と探索メタ情報のみ
 * - `matched_store_id` は `stores.id` への nullable FK (ON DELETE SET NULL)。
 *   店舗削除時に候補レコード自体は残す
 * - `first_seen_at` / `last_seen_at` / `created_at` / `updated_at` は既存規約に従い
 *   `YYYY-MM-DD` 形式の text
 *
 * 関連: types/place-candidate.ts, lib/db/place-candidate-repository.ts
 */
export const placeCandidates = pgTable("place_candidates", {
  id: text("id").primaryKey(),
  google_place_id: text("google_place_id").notNull(),
  status: text("status").notNull().default("candidate"),
  first_seen_at: text("first_seen_at").notNull(),
  last_seen_at: text("last_seen_at").notNull(),
  seen_count: integer("seen_count").notNull().default(1),
  discovery_sources: jsonb("discovery_sources").$type<string[]>().notNull().default([]),
  last_searched_keyword: text("last_searched_keyword"),
  last_searched_area: text("last_searched_area"),
  last_center_lat: real("last_center_lat"),
  last_center_lng: real("last_center_lng"),
  last_radius_meters: integer("last_radius_meters"),
  last_distance_meters: real("last_distance_meters"),
  last_is_within_radius: boolean("last_is_within_radius"),
  matched_store_id: text("matched_store_id").references(() => stores.id, {
    onDelete: "set null",
  }),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("place_candidates_google_place_id_idx").on(table.google_place_id),
  // store-cascade-delete (#152): FK 列インデックス。店舗削除時の SET NULL 走査と
  // 削除影響カウント (getDeleteImpact) の seq scan を回避する。
  index("place_candidates_matched_store_id_idx").on(table.matched_store_id),
]);

/**
 * store_research_runs テーブル (AI 店舗調査再設計 Plan v3.2, PR1: データモデル基盤)
 *
 * AI による 53 項目調査の 1 回の実行 (run) を表す。53 項目の候補結果 (`result`) と
 * `stores.basic_info` は完全に分離しており、AI が自動的に `basic_info` を上書きする
 * ことはない (人間が「採用」した項目のみ `mergeBasicInfo(..., "manual")` で反映する)。
 *
 * - `id` は `<entity>_<id>` 形式の text PK (既存規約)
 * - `store_id` は `stores.id` への FK (ON DELETE CASCADE)
 * - `status` / `stage` は Postgres ENUM 化せず text として保持 (既存規約)。
 *   値の妥当性はアプリ層型ガード (`types/research-run.ts`) で担保する
 * - `result` / `token_usage` は run 未完了時 NULL、`source_registry` /
 *   `review_decisions` / `warnings` は基本情報 (`stores.basic_info`) と同じ jsonb
 *   規約で「未設定時も空配列/空オブジェクト」とする (NOT NULL DEFAULT)
 * - `started_at` / `expires_at` / `finished_at` は他テーブルの `YYYY-MM-DD` text
 *   規約とは意図的に異なり `timestamptz` (ISO 8601 文字列, mode: "string") を使う。
 *   所要時間の算出・stuck run 検出には日単位粒度では不十分なため
 * - `expires_at` は Vercel Workflow 採用後も監査・異常検知用の軽量な参考値として
 *   保持する (`types/research-run.ts` の JSDoc 参照。役割は waitUntil 時代の
 *   「lazy sweep による能動的失敗遷移」から後退するが、Workflow 自体には
 *   「run が想定より明らかに長く running のまま」を機械的に検知する固有の仕組みが
 *   無いため、この列を廃止しない)
 * - 二重実行防止: `status='running'` の店舗は 1 行のみに制限する部分ユニーク
 *   インデックスを持つ (`ai_prompt_templates_default_idx` と同じ手法)
 *
 * 関連: Plan v3.2 §12, §13, §15, §17
 */
export const storeResearchRuns = pgTable(
  "store_research_runs",
  {
    id: text("id").primaryKey(),
    store_id: text("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    /** 起動者の監査用。`profiles.id` への FK (nullable、システム起動等を許容)。 */
    requested_by_user_id: uuid("requested_by_user_id").references(
      () => profiles.id,
    ),
    /** `'running' | 'succeeded' | 'failed'`。アプリ層型ガードで担保 (既存規約)。 */
    status: text("status").notNull().default("running"),
    /** `'discovering' | 'researching' | 'done'`。running 中のみ意味を持つ。 */
    stage: text("stage"),
    /** 53項目候補 (`ResearchItem[]`)。未完了時 NULL。 */
    result: jsonb("result").$type<ResearchItem[]>(),
    /** Stage1 + Stage1.5 で構築した Source Registry。モデル自由生成URLは含まない。 */
    source_registry: jsonb("source_registry")
      .$type<SourceRegistryEntry[]>()
      .notNull()
      .default([]),
    /** ユーザーの採用/却下/スキップ操作の永続化。key は ResearchItem.key。 */
    review_decisions: jsonb("review_decisions")
      .$type<ReviewDecisions>()
      .notNull()
      .default({}),
    /** 明示的な「レビュー完了」操作の記録。NULL = レビュー未完了。 */
    review_completed_at: timestamp("review_completed_at", {
      withTimezone: true,
      mode: "string",
    }),
    /** Stage毎のトークン使用量記録 (コスト監視用)。形状は PR2 で確定。 */
    token_usage: jsonb("token_usage").$type<Record<string, unknown>>(),
    /** run単位の非致命的な警告 (例: Places軽量再同期の失敗通知)。 */
    warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
    /** `AiClientError` と同種の正規化済みエラー種別。 */
    error_kind: text("error_kind"),
    error_message: text("error_message"),
    started_at: timestamp("started_at", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
    expires_at: timestamp("expires_at", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
    finished_at: timestamp("finished_at", {
      withTimezone: true,
      mode: "string",
    }),
  },
  (table) => [
    // 店舗ごとの最新run取得用 (「要確認」判定・過去run一覧に使用)。
    index("store_research_runs_store_started_idx").on(
      table.store_id,
      table.started_at,
    ),
    // 二重実行防止: 同一店舗で status='running' の行は1件のみ許可する。
    uniqueIndex("store_research_runs_running_store_idx")
      .on(table.store_id)
      .where(sql`${table.status} = 'running'`),
  ],
);
