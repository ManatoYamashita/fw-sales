# Gap Analysis: store-flow-guidance

調査日: 2026-06-08 / 対象: requirements.md R1–R8 / 方針: grill 策定 D1–D12 (#122, memory `store_flow_guidance_issue`)

## 1. 既存資産マップ (Current State)

### 店舗詳細 (主導線)
- `app/(main)/stores/[id]/page.tsx` … 既に `getStoreCached(id)` と `getDeepResearchReport(store.id)` を取得済み(`deepResearchReport`)。`store.ai_analysis_result` も Store 型に含む。**状態導出に必要な信号は既にこのページで揃っている**(追加 query 不要)。
- `_components/store-title-section.tsx` … 店舗名・見出し。**状態バッジ + 単一 CTA の最有力着地点**。
- `_components/store-detail-tabs.tsx` … 基本情報 / 補足 / AI 分析タブ。`ai-analysis-detail-section.tsx`(`ai_analysis_result` の表示・再実行 = 「生成済」CTA の着地先候補)。
- `_components/deep-research-section.tsx` + `_components/deep-research-enqueue-button.tsx` … **死蔵 cron(#43 deep-research-pipeline)の「Deep Research を実行」CTA が残存**。新設する単一 CTA と意味が競合する(Constraint)。
- `components/feature/research-status-badge.tsx` … 既存バッジだが **cron ジョブ状態(queued/researching/structuring/failed)用**で、本仕様の 4 フェーズ(未調査/調査可/調査取込済/生成済)とは意味が異なる。流用不可、別バッジが必要。

### 貼付ワークベンチ (STEP0 新設先)
- `app/(main)/research/[storeId]/page.tsx` … `getStoreCached` + `getDeepResearchReport` を取得し `PasteWorkbench` に渡す。
- `app/(main)/research/[storeId]/_components/paste-workbench.tsx` … STEP1(貼付・構造化) / STEP2(51 項目プレビュー) / STEP3(架電生成)。`onCopy`(clipboard)は既存(STEP3 のスクリプトコピーで使用)。**STEP0(調査プロンプト生成・コピー + Gem 起動)は未存在(Missing)**。
- `lib/actions/research-paste-actions.ts` … `structureFromPastedMarkdownAction`(STEP1) / `generateCallScriptFromMarkdownAction`(STEP3)。改修不要、CTA の着地先。

### 状態導出の信号源
- `lib/db/schema.ts:80-133` stores テーブル。コア列 `address` / `genre` / `phone` / `business_hours`(全て `NOT NULL default ""`)、`review_count`(`integer NOT NULL`)。`ai_analysis_result`(`text` nullable)。**未充足は NULL でなく `""` / `0` で表現される(D5 の sentinel 判定)**。
- `lib/queries/deep-research.ts` `getDeepResearchReport(storeId)` … 調査結果(構造化 51 項目)の有無 = 現状の「調査取込済」信号。⚠️ **#121 が Stage2 構造化を撤去すると本信号が消える(D12)** → `getStoreResearchPhase` で隠蔽し差し替える。
- `lib/places/to-store-input.ts` `placeResultToStoreInput` … Place→StoreInput 扁平化。充足率評価の対象列の整合確認に参照。

### 調査プロンプト生成
- `lib/ai/deep-research/prompt.ts` `buildDeepResearchPrompt`(Stage1) … 51 項目指示 + 出典規則込みの完全プロンプト。**死蔵 cron 用で手動ワークベンチからは未使用。D6 により流用しない**。
- **基本情報サマリ生成ヘルパは未存在(Missing)**。`buildBasicInfoBlock`(#114 で 1 本化予定)も現状コードに無い → 軽量サマリを本仕様で別途用意。

### 設定 (Gem URL)
- `app/(main)/settings/_components/` … `ai-prompt-templates-card.tsx` / `ai-prompt-template-dialog.tsx`(プロンプトテンプレ管理) / `data-actions.tsx` / `theme-toggle-card.tsx`。
- `lib/db/schema.ts:394` `aiPromptTemplates` pgTable + `lib/repositories/prompt-template-repository.ts` + `lib/queries/prompt-templates.ts` … テンプレ永続化の前例。
- **汎用 key-value 設定テーブルは存在しない(Constraint)**。Gem URL の永続化機構は未決(新規列/テーブル or テンプレ機構流用)→ design で確定。

## 2. Requirement-to-Asset Map

| 要件 | 既存資産 | 扱い | Gap (Missing/Unknown/Constraint) |
|---|---|---|---|
| R1 状態の導出・可視化 | page.tsx(信号取得済), store-title-section | 改修+新規 | 4 フェーズ用バッジ(Missing)、research-status-badge は意味相違(流用不可) |
| R2 状態別単一 CTA | store-title-section, ai-analysis-detail-section | 新規+配線 | 死蔵 enqueue-button CTA との競合整理(Constraint) |
| R3 #114 非依存導出 | getDeepResearchReport, ai_analysis_result | 新規 | `getStoreResearchPhase` ヘルパ(Missing)、#121 信号差し替え方針(Unknown) |
| R4 充足率判定 | stores コア列, placeResultToStoreInput | 新規 | 充足率純関数 + sentinel("" / 0)判定(Missing) |
| R5 STEP0/プロンプト/Gem | paste-workbench(onCopy), settings | 新規 | STEP0 UI(Missing)、基本情報サマリ生成(Missing)、Gem URL 永続化(Unknown) |
| R6 連続完了 | paste-workbench STEP1/STEP3 | 流用 | STEP0 を非破壊で前置(Constraint) |
| R7 経路非依存互換 | 状態機械(R1-R4) | 流用 | — (どの経路も同一導出に乗る) |
| R8 Gem URL 設定 | aiPromptTemplates 前例, settings カード群 | 新規 | Gem URL の保存方式(Unknown)、未設定時のフォールバック(Missing) |

## 3. Implementation Approach Options

### A. 状態導出ヘルパ (`getStoreResearchPhase`)
- 純関数 `(store, report|null) => "untouched" | "ready" | "researched" | "generated"`。信号: `ai_analysis_result` 有 → generated / report 有 → researched / コア充足率 ≥3/5 → ready / else → untouched。
- #121 着地時は report 信号を「貼付原文の有無」等へ差し替え(本関数 1 箇所のみ変更)。
- 配置候補: `lib/queries/stores.ts` 近傍 or `lib/stores/research-phase.ts`(純関数・テスト容易)。

### B. STEP0 と基本情報サマリ
- `paste-workbench.tsx` の STEP1 手前に Card 追加。サマリ生成は純関数 `buildBasicInfoSummary(store)`(店名/住所/業態/電話/URL 等を Markdown 整形)→ 既存 `onCopy` で流用。
- 将来 #114 の `buildBasicInfoBlock` に吸収される前提で、署名/出力を寄せておく。

### C. Gem URL 永続化 (要 design 決定)
- 候補1: `aiPromptTemplates` 同様の単独テーブル/列。候補2: 環境変数(NEXT_PUBLIC は build 時埋め込みの地雷 [memory: vercel_next_public_build_time_embedding] のため非推奨)。**推奨: DB 保存(設定カード新設)**。

### D. 死蔵 cron CTA の整理
- `deep-research-section` / `deep-research-enqueue-button` は新 CTA と意味が競合。最小衝突のため本仕様では**新 CTA を主導線として前面化し、死蔵 CTA の撤去は #110(旧 cron 撤去)に委ねる**(D7 加筆のみ方針と整合)。design で表示分岐を確定。

## 4. 制約・リスク
- `.env.local` 本番直結 / migrate は CI 任せ。Gem URL を DB 列で持つ場合マイグレーションは CI 経由。[memory: env_local_production_supabase, drizzle_orphan_migration_0004]
- **#121 依存リスク**: 「調査取込済」信号が構造化有無に依存。`getStoreResearchPhase` 隠蔽で吸収(D12)。
- **#114 スコープ重複回避**: 生成集約・basic_info 化には踏み込まない(D7)。並行セッション衝突に注意。[memory: concurrent_branch_collision]
- **既存 CTA 競合**: 死蔵 enqueue-button と新 CTA の二重提示を避ける表示分岐が必須。
