# Gap Analysis — deep-research-pipeline

> **2026-09-03 更新**: 本ファイルは **2026-05-17 時点のスナップショット** です。
> 仕様は #110 で全撤去済み (`spec.json` の `phase` は `removed`)。現行コードベースの
> 調査結果としては使えません。後継は AI 店舗調査 (Plan v3.2 / Issue #180): `app/(main)/research/**` / `lib/ai/research/**` / `workflows/store-research.ts`。

**Date**: 2026-05-17
**Inputs**: `requirements.md` (R1〜R8), `.kiro/steering/{product,tech,structure}.md`, Issue #43
**Scope**: 既存 fw-sales コードベースに対する Deep Research 非同期パイプラインの実装ギャップを洗い出し、設計フェーズへ持ち越す論点を整理する。

---

## 1. Current State Investigation

### 1.1 AI 層（`lib/ai/`）

| ファイル | 役割 | 再利用度 |
|---|---|---|
| `lib/ai/client.ts:1-198` | `@google/genai` ラッパ、`AiClientError` discriminated union、`responseJsonSchema` + 60 秒 AbortSignal | パターン再利用（同期 60 秒制約を継承しない） |
| `lib/ai/schema.ts:1-152` | `AiAnalysisResult` Zod スキーマ、`getAiAnalysisJsonSchema()`、`stripUnsupportedKeys()`、`CONFIDENCE_FIELDS` 5 項目 | パターン再利用（51 項目用に別スキーマ新規） |
| `lib/ai/validate.ts:1-54` | Zod `safeParse` で `schema_violation` を返す二段防御 | パターン再利用 |
| `lib/ai/prompt.ts` | `BuildAnalysisPromptInput` + Few-shot 2 例埋込、`assigned_sales` neutral 化 | 別プロンプトを新規 |
| `lib/ai/rate-limiter.ts:1-70+` | per-store (10 分/5 回) + global (60 秒/10 回) のプロセス内 Map | 別系統のレート制御を新規 |

### 1.2 DB 層（`lib/db/`, `drizzle/`）

| 項目 | 現状 |
|---|---|
| Drizzle スキーマ | `stores`/`research`/`deals`/`handoffs`/`notifications`/`profiles` 定義済 (`lib/db/schema.ts:1-236`) |
| `notifications.kind` | text 列。新規 kind 追加で破壊変更なし（R7#4 整合） |
| `stores.ai_analysis_result` | JSON stringify text。Deep Research は独立カラム/テーブルに切る前提 |
| マイグレーション最新 | `drizzle/0007_add_store_google_place_id.sql`。次は **0008** |
| 接続 | `postgres.js` + Drizzle 2.0、`prepare: false` (Supabase Transaction Pooler 互換) |

### 1.3 Repository / Cache / Actions

| レイヤ | キーアセット | 観察 |
|---|---|---|
| Repository | `lib/repositories/index.ts:1-121` の `TxRepos` interface と `repos.transaction()` | 新規 `DeepResearchRepository` を `TxRepos` に追加して原子性確保可 |
| Cache | `lib/cache.ts:6-27` の `CACHE_TAGS` 定数 | `deepResearchByStore(storeId)` / `deepResearchJob(jobId)` を追加 |
| Server Actions | `lib/actions/_helpers.ts:1-58` の `ActionResult<T>` + `success/failure/readString/readNumber` | 新規 action でも同型 |
| 同期分析 action | `lib/actions/ai-analysis-actions.ts:1-95+` (`analyzeStoreAction`) — SDK エラーを `failure()` に正規化 | 流儀踏襲 |

### 1.4 API ルート

- `app/api/export/route.ts:1-37` のみ存在。Node.js runtime 強制パターン。
- `vercel.json` 空（前コミット `c382619` で Cron + Resend 削除済）。
- **新規必要**: `app/api/cron/poll-research/route.ts`（CRON_SECRET 認可 + 1 ジョブ/tick + 55 秒デッドライン）

### 1.5 UI / ルート層

| ファイル | 役割 | Deep Research での扱い |
|---|---|---|
| `app/(main)/stores/[id]/page.tsx` | RSC: 店舗詳細。`getStoreCached()` → `StoreDetailTabs` | 既存に Deep Research タブを増設 |
| `app/(main)/stores/[id]/_components/store-detail-tabs.tsx` | Compound Tabs（基本/補足/AI 分析） | **拡張**: Deep Research タブ追加 |
| `app/(main)/stores/[id]/_components/ai-analysis-detail-section.tsx` | 同期 5 項目 AI 分析の表示・編集・保存 | **共存**（R7#1, R7#2） |
| `app/(main)/stores/new/_components/area-search-results.tsx` | エリア検索結果一覧 | **触らない**（R1#4） |
| `components/layout/topbar.tsx` | Sticky header。**Bell icon は未実装** | **拡張**: 通知ドロップダウン新設 |
| `components/layout/nav-badges.tsx` | RSC で sidebar badges を `loadNavBadgeCounts()` 経由ロード | **拡張**: queued ジョブ件数バッジ追加検討 |
| `lib/domain/nav.ts` | `NAV_ITEMS` 7 項目（`/research` は disabled） | **判断保留**: 専用ナビ項目を作るか、店舗詳細タブのみで終わらせるか |

### 1.6 UI プリミティブ再利用可否

| プリミティブ | 用途 | 再利用 |
|---|---|---|
| `components/ui/card.tsx` | Compound `Card.Header/Body/Footer` | レポート Section |
| `components/ui/tabs.tsx` | 8 カテゴリ・51 項目のセクション分け | カテゴリ切替 |
| `components/ui/badge.tsx` | A/B/C 区分、queued/researching/...状態 | そのまま使用可 |
| `components/ui/toast.tsx` | 4s timeout、tone:info/success/warning/error | 登録完了/エラーフィードバック |
| `components/ui/modal.tsx` | focus trap + Escape 対応済 | 引用元抜粋・全文プレビュー |
| `components/ui/spinner.tsx` | `Loader2` + `animate-spin` | 進行中インジケータ |
| `components/feature/*-badge.tsx` | data-attr 色決定パターン | 状態 Badge 新設の手本 |

---

## 2. Requirements Feasibility Analysis（要件 → アセット対応表）

| 要件 ID | 主な技術ニーズ | 既存アセット | ギャップ |
|---|---|---|---|
| **R1** 1 店舗単位キュー登録 | `enqueueDeepResearchAction(storeId)`、店舗詳細画面の CTA、重複ジョブ検出 | `ActionResult` + Card/Button + `repos.transaction()` | **Missing**: `research_jobs` テーブル、`DeepResearchRepository`、CTA UI、重複検出ロジック |
| **R2** 非同期実行・ユーザー操作からの独立 | スケジューラ駆動、状態遷移、実行枠時間切れ時のジョブ保持 | なし（バックグラウンドジョブ基盤ゼロ） | **Missing**: GitHub Actions workflow、Vercel エンドポイント、状態管理、`Date.now() + 55_000` デッドライン |
| **R3** 51 項目構造化レポート | Deep Research API 呼出 → Markdown 取得 → gemini-2.5-flash-lite で構造化 | `getAiAnalysisJsonSchema()` パターン、`validate.ts` 二段検証 | **Missing**: Deep Research SDK 呼出層、51 項目 Zod スキーマ、Stage 2 構造化クライアント、A/B/C 区分付与ロジック |
| **R4** アプリ内通知 | `notifications` テーブル拡張、Topbar Bell、通知から店舗レポートへの導線 | `notifications` テーブル + Toast プリミティブ | **Missing**: 新規 `kind` 値定義（`deep_research_done` 等）、Bell dropdown UI、通知作成ヘルパ |
| **R5** 状態可視化・再投入 | 状態バッジ、ジョブログ、スタック検出（6h）、手動再投入 | `Badge` + `Tabs` | **Missing**: 状態バッジコンポーネント、`error_log` JSON 列、スタック判定クエリ、`retryDeepResearchAction()` |
| **R6** 利用上限・認可 | 1 日/月次上限、警告通知、`CRON_SECRET` Bearer 認可、ログのキーマスク | `lib/env.ts:readEnv`、`AiClientError` のキー漏洩防止パターン | **Missing**: 上限カウンタ実装（DB 集計 or 別テーブル）、警告通知ヘルパ、`/api/cron/poll-research` の認可ミドルウェア |
| **R7** 既存機能との境界 | 同期 5 項目 AI 分析と共存、店舗詳細での視覚区別、`notifications` 拡張で破壊変更なし | 既存 `AiAnalysisDetailSection`、`notifications.kind` text 列 | **Missing**: Deep Research タブ実装、凡例表示、`kind` 値追加 |
| **R8** 運用品質目標・観測性 | コスト概算・所要時間記録、月次集計、失敗理由分類 | なし | **Missing**: `research_reports.total_cost_yen` / `total_duration_sec` 列、ジョブログテーブル設計 |

### 2.1 Research Needed（設計フェーズへ持ち越す未確定事項）

1. **Gemini Deep Research SDK 実体**: `@google/genai@1.52.0` の `interactions.create({ background: true })` の有無、`task_id` の取得方法、`getInteraction(taskId)` のレスポンス構造、`steps[].content[].text` の存在保証
2. **コスト/トークン取得**: Deep Research が 1 タスクあたりの token usage / billed cost をレスポンスに含めるかどうか（R8#1 のコスト記録に必要）
3. **gemini-2.5-flash-lite モデル ID**: 正式モデル名（候補: `gemini-2.5-flash-lite` / `gemini-2.5-flash-lite-preview-*`）、`responseJsonSchema` サポート確認
4. **GitHub Actions 60 日無活動対策**: noop commit / scheduled `workflow_dispatch` ping / 別 trigger（Actions API push）のいずれを採るか
5. **Vercel Hobby ToS グレーゾーン受容範囲**: いつ Pro 移行を再評価するか、判断基準の明文化
6. **51 項目の正規化キー定義**: 8 カテゴリ × 各項目の英語キー名（snake_case）と日本語表示名の確定マップ（Issue #43 §2 の項目を JSON Schema に落とす作業）
7. **A/B/C 区分付与の主体**: Stage 1 (Deep Research) で区分を生成するか、Stage 2 (構造化) で付与するか
8. **進捗 polling 頻度と DB ロック**: `*/30 * * * *` cron + 1 ジョブ/tick で十分か、同時複数ジョブ並走時の `FOR UPDATE SKIP LOCKED` 採用可否（postgres.js + Drizzle）

---

## 3. Implementation Approach Options

### Option A: 既存 `lib/ai/client.ts` に Deep Research モードを追加

**When**: 既存 60 秒同期処理に Deep Research フラグを足してモード分岐

- ❌ 同期 60 秒制約と非同期 Deep Research を 1 ファイルに混載 → `AiClientError` 型の意味が変質
- ❌ `lib/ai/rate-limiter.ts` も二系統混合になりテストが困難
- ❌ `responseJsonSchema` + `tools` の同時 400 制約により、Deep Research は Stage 1 と Stage 2 を別呼出に分けざるを得ず、結局 2 ファイル相当のコードを 1 ファイルに詰めるだけ
- **不採用**

### Option B: 完全独立モジュール `lib/ai/deep-research/*` を新規

**When**: 既存同期分析と一切交差せずに並走

- ✅ ライフサイクル・エラーモデル・レート制御をクリーンに分離
- ✅ 同期分析の動作を破壊しない（R7#1 担保）
- ✅ 51 項目スキーマ・Few-shot・プロンプトを Deep Research 専用に最適化
- ❌ 共通化できる `validate.ts` パターンや `stripUnsupportedKeys()` を重複実装するリスク
- 採用可能だがやや過剰分離

### Option C: 共通基盤を抽出した上で新規モジュールを作る（推奨）

**When**: パターン再利用 + 関心分離の両立

- **Phase 1**（基盤）: `lib/db/schema.ts` に `research_jobs` / `research_reports` 追加、マイグレーション 0008、`CACHE_TAGS` 拡張、`DeepResearchRepository` 追加
- **Phase 2**（クライアント）: `lib/ai/deep-research/client.ts`（SDK 呼出 + `interactions.create/get`）、`lib/ai/deep-research/schema.ts`（51 項目 Zod）、`lib/ai/deep-research/prompt.ts`、`lib/ai/structurer.ts`（gemini-2.5-flash-lite 呼出 — 既存 `responseJsonSchema` パターンを共通ヘルパに昇格）
- **Phase 3**（パイプライン）: `app/api/cron/poll-research/route.ts`（55 秒デッドライン + 1 ジョブ/tick + CRON_SECRET 認可）、`.github/workflows/poll-research.yml`、`lib/actions/deep-research-actions.ts`（enqueue/retry/getStatus）
- **Phase 4**（UI）: `app/(main)/stores/[id]/_components/deep-research-tab.tsx`、CTA Button、`components/feature/research-status-badge.tsx`、`components/layout/notification-bell.tsx`
- **Phase 5**（通知・観測）: `notifications.kind` に `deep_research_done` / `deep_research_failed` / `deep_research_budget_warning` 追加、月次集計クエリ

**共通化候補**:
- `stripUnsupportedKeys()` / Gemini JSON Schema 整形ロジック → `lib/ai/_shared/json-schema-utils.ts` に切り出して Deep Research 構造化と既存同期分析の双方から参照
- `AiClientError` 系の正規化ロジック → 同上

**Trade-offs**:
- ✅ パターン再利用と関心分離の両立
- ✅ Phase 単位で承認 → 実装が可能（リスクの段階的削減）
- ✅ 同期分析を破壊しない
- ❌ Phase 1〜2 で基盤コードが増えるため初期コミット量が膨らむ
- ❌ 共通化（`_shared/`）は導入してから既存コードも書換えになるので、規模が中程度に膨らむ

**推奨**: **Option C（Hybrid）** を採用。

---

## 4. Implementation Complexity & Risk

### Effort: **L（1〜2 週間）** 〜 **XL（2 週間以上）**

- DB マイグレーション（S）+ Repository/Cache 拡張（S）= 1〜2 日
- Deep Research クライアント + 構造化クライアント + プロンプト + スキーマ（M）= 3〜5 日
- API エンドポイント + GitHub Actions workflow + 認可 + 動作確認（M）= 2〜3 日
- UI（Deep Research タブ + Status Badge + 通知 Bell）（M）= 3〜5 日
- 観測ログ + 上限制御 + スタック検出（S〜M）= 2〜3 日
- 合計: 約 11〜18 営業日 → **L 寄り、未確定事項次第で XL に膨らむ**

### Risk: **High**

| 区分 | リスク | 緩和策 |
|---|---|---|
| 技術 | `@google/genai@1.52.0` で Deep Research API の実体が不明（背景タスク投入 / polling 経路） | Phase 2 着手前に SDK 動作確認 PoC（`spike/`）で 1 日切る |
| 技術 | gemini-2.5-flash-lite の `responseJsonSchema` 対応有無、51 項目を 1 回で吐ききるトークン上限 | PoC で 1 件分の構造化を実機検証してから本実装 |
| 運用 | Vercel Hobby ToS グレーゾーン、業務用途でのアカウント停止 | Issue #43 R9 で受容済。Pro 移行判断条件を design 側で明文化 |
| 運用 | GitHub Actions 60 日無活動で自動無効化 | noop ping workflow を毎週 1 回スケジュール |
| 運用 | cron 遅延 10〜30 分が常態化 → R8 の 翌朝 08:00 JST SLA を逸脱する可能性 | 設計で「目標」と明記、SLA 逸脱は警告通知に倒す |
| コスト | 月 ¥4,500〜¥135,000 のレンジ。上限制御失敗で枯渇 | R6 の運用上限 + 80% 警告で二段防御 |
| データ | 51 項目スキーマの破壊変更が生じやすい（試行錯誤期） | Drizzle マイグレーションを破壊変更不可で運用、列追加方針で進める |

---

## 5. Recommendations for Design Phase

### 推奨アプローチ
**Option C（Hybrid）** を採用し、設計フェーズで以下を Boundary Commitments として確定する。

1. **テーブル設計**（R8 の観測要件を満たす列を確定）
   - `research_jobs`: `id`, `store_id` FK, `user_id` FK, `status` (`queued`|`researching`|`structuring`|`done`|`failed`), `deep_research_task_id` text nullable, `attempts` int, `error_log` jsonb, `enqueued_at`, `research_started_at`, `research_completed_at`, `completed_at`
   - `research_reports`: `id`, `store_id` FK, `job_id` FK, 8 カテゴリ jsonb 列 (`category_1_basic` 〜 `category_8_owned_media`), `hearing_questions` jsonb, `full_markdown` text, `all_source_urls` jsonb, `total_cost_yen` numeric nullable, `total_duration_sec` int, `created_at`
2. **API 認可方式**: Bearer `CRON_SECRET`（GitHub Secrets / Vercel Env Vars 両方に設定）
3. **デッドライン制御**: `Date.now() + 55_000` を `/api/cron/poll-research` の処理開始時に固定し、Stage 2 構造化呼出には `deadline - Date.now() - 3_000` ms を残す
4. **共通基盤の抽出範囲**: `lib/ai/_shared/json-schema-utils.ts` に `stripUnsupportedKeys()` を移し、既存同期分析もここから参照
5. **Stage 1/Stage 2 分割境界**: Stage 1 (Deep Research) は Markdown レポート + 引用元 URL 群の取得のみ、Stage 2 (gemini-2.5-flash-lite) で 51 項目への構造化と A/B/C 区分付与
6. **UI 配置**: 店舗詳細画面に「Deep Research」タブを追加（`/research` ナビ項目の有効化は本リリースでは保留）

### 設計フェーズに持ち越す Research 項目（再掲）
- R-1: Gemini Deep Research SDK の実体確認（PoC 推奨）
- R-2: gemini-2.5-flash-lite 構造化能力の実機検証
- R-3: コスト/token usage の SDK レスポンス露出可否
- R-4: 51 項目の英語キー定義マッピング
- R-5: A/B/C 区分付与の主体（Stage 1 vs Stage 2）の選択
- R-6: 並走時の DB ロック方針
- R-7: GitHub Actions 60 日無活動の対策方針確定
- R-8: Vercel Pro 移行の判断基準

### 段階的実装の推奨順序
1. **Phase 1.1**: Drizzle 0008 マイグレーション + Repository / CACHE_TAGS 拡張（リスクほぼゼロ、ロールバック容易）
2. **Phase 1.2**: SDK PoC（`spike/`）で Deep Research API 実体を確認 → 設計確定
3. **Phase 1.3**: Deep Research クライアント + 構造化クライアント + プロンプト + スキーマ
4. **Phase 1.4**: `/api/cron/poll-research` + GitHub Actions workflow + 認可
5. **Phase 1.5**: UI（Deep Research タブ + Status Badge + 通知 Bell + Toast 統合）
6. **Phase 1.6**: 観測ログ + 上限制御 + スタック検出

---

## Design Synthesis（design.md 確定時点）

### 1. Generalization
- **発見**: 既存同期 5 項目 AI 分析と新規 51 項目 Stage 2 構造化は、いずれも Gemini に `responseMimeType: "application/json"` + `responseJsonSchema` を強制し、Zod で二段検証する同型処理
- **適用**: `lib/ai/_shared/json-schema-utils.ts` を新設し、`stripUnsupportedKeys()` と `propertyOrdering` ヘルパを抽出。既存 `lib/ai/client.ts` / `lib/ai/schema.ts` は import 切替のみで挙動不変
- **非適用**: `AiClientError` / `DeepResearchClientError` / `StructurerError` の各 discriminated union は **統合せず別系統で並存**。同期と非同期で意味論が異なる（特に `rate_limit` の対応差・`timeout` の意味）

### 2. Build vs. Adopt
| 対象 | 判断 | 根拠 |
|---|---|---|
| ジョブキュー基盤 | **Build**（postgres + 自前テーブル） | Redis / SQS / Inngest 等は追加コスト発生、社内ツール規模では過剰。`research_jobs` 1 テーブル + `FOR UPDATE SKIP LOCKED` で十分 |
| Gemini Deep Research | **Adopt** | 51 項目相当の Web リサーチを自前構築するのは非現実的、Google が提供する Deep Research API を利用 |
| ジョブスケジューラ | **Adopt（GitHub Actions）** | Vercel Hobby Cron は 1/day 制限、自前 worker daemon は Vercel に置けない |
| 通知テーブル | **Adopt（既存 `notifications`）** | スキーマ拡張なし、`kind` text 値追加のみで R7#4 整合 |
| 認可フレームワーク | **Build（最小: Bearer 比較）** | OAuth / JWT は不要、共有シークレット 1 本で十分 |

### 3. Simplification
- **自動リトライを廃止**: 既存設計の "retry with backoff" は導入せず、失敗時は **手動再投入で新規行**（R5#6）。失敗原因の人間判断を強制し、無駄な API コスト消費を避ける
- **ステータス pub/sub を廃止**: WebSocket / SSE は導入せず、UI は cache-tagged query の SWR で十分（R2.3 の状態保持は DB に固定値を持てば達成可）
- **通知センター UI を廃止**: 専用ページは作らず、Topbar Bell + ドロップダウン（既存 `Modal` プリミティブの軽量利用）のみ
- **状態遷移を単方向に**: `queued → researching → structuring → done` の前進のみ。`failed → queued` は元行を書換えず新規行を作る（監査性確保）

### Phase 0: SDK PoC 計画（design.md 確定後に着手）
- **目的**: `@google/genai@1.52.0` の Deep Research API 実体確認、`gemini-2.5-flash-lite` の構造化能力検証、コスト/token usage 露出有無の確認
- **成果物**: `spike/deep-research-poc.ts` で 1 件分の Stage 1 + Stage 2 を実行、ログを本 research.md に追記
- **設計影響**: 想定と乖離があった場合 `design.md` の SDK 章 (`DeepResearchClient` の `startTask`/`getTask` シグネチャ) を修正。interface 自体は維持し、`lib/ai/deep-research/client.ts` 実装で差異を吸収
- **着手判断**: Phase 1.1 (Drizzle マイグレーション) は PoC と並行可能。Phase 1.2 (AI クライアント実装) は PoC 完了後に着手

---

## Phase 0 PoC Execution Log

**実行ステータス**: 未実行（agent 環境では Gemini API 課金リスクのため実行を保留）

### PoC 成果物
- `spike/deep-research-poc.ts` — Phase 0 PoC スクリプト雛形（コミット対象外、`.gitignore` 登録済）
- 確認項目（実行前に research.md に書込済）:
  1. `@google/genai@1.52.0` の Deep Research API シグネチャ実体（`interactions.create` / `interactions.get` / cancel 系）
  2. `gemini-2.5-flash-lite` の `responseMimeType: "application/json"` + `responseJsonSchema` 動作
  3. SDK レスポンスの token usage / コスト概算露出
- 認証ヘルパ確認: `lib/supabase/server.ts:99-128` に `getCurrentSession()` / `getCurrentProfile()` あり。`getCurrentUser()` という名称のヘルパは存在しないため、design.md / 実装側で正しい関数名へ置換すること

### ユーザー実行手順
1. `.env.local` に `GEMINI_API_KEY=...` を設定
2. `pnpm tsx spike/deep-research-poc.ts` で実行
3. 結果ログを本セクション末尾に追記（実行日時、SDK 応答形、確認できた点、想定との差分）
4. 想定と乖離があれば `design.md` §DeepResearchClient interface 章を更新

### 期待されるアウトプット例
```
=== Phase 0 PoC ===
[Step 1] Created interaction: { name: "interactions/...", state: "in_progress" }
[Step 2] Response text: { "name": "サンプル", ... }
[Step 2] Usage metadata: { "promptTokenCount": ..., "candidatesTokenCount": ... }
```
