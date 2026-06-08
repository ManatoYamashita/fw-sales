# Gap Analysis: store-basic-info

調査日: 2026-06-07 / 対象: requirements.md R1–R8 / 方針: grill 策定 D1–D8 (#114, memory `basic_info_store_redesign`)

## 1. 既存資産マップ (Current State)

### データ層
- `lib/db/schema.ts:80-133` stores テーブル(調査系スカラー多数)。jsonb 列追加前例: `drizzle/0008_add_deep_research.sql`(research_reports に 8 jsonb 列)。
- `lib/repositories/store-repository.ts` interface(list/get/create/update/delete/bulkDelete、Store 型 I/O)
- `lib/db/store-repository.ts` Drizzle 実装。`toDbRow`(JSON.stringify) / `fromDbRow`(parse + Zod)、**`update` = 現在値 read → patch マージ → write の原子性**(D3 マージの足場として再利用可)
- `types/store.ts` Store / StoreInput / StorePatch(Patch = Partial<Input>)

### 充填源
- エリア検索: `lib/places/to-store-input.ts:61-102` placeResultToStoreInput(Place→StoreInput 扁平化)、`lib/actions/area-search-actions.ts:86-137` bulkAddStoresFromPlacesAction。一括登録 UI は #108/#117 で実装済・稼働(旧 #103 相当)。**Place→basic_info マッピングは未存在**。
- AI リサーチ: `lib/actions/research-paste-actions.ts` structureFromPastedMarkdownAction(markdown→research_reports 保存) / generateCallScriptFromMarkdownAction(markdown→AiAnalysisResult、updateStorePatch で保存)
- 同期分析: `lib/actions/ai-analysis-actions.ts:121` analyzeStoreAction(フォーム + HTML + 任意 DR markdown→AiAnalysisResult)

### AI 契約
- `lib/ai/schema.ts:36` AiAnalysisResult(strengths / weaknesses / gourmet_paid_status / gbp_completeness / call_script + confidence)。**#113 で現状維持**。
- `lib/ai/prompt.ts:110` buildAnalysisPrompt、`lib/ai/deep-research/schema.ts:187` DEEP_RESEARCH_ITEMS(実 50 / 正典 51)、structurer(Stage 2 構造化)

### UI / Query / Cache
- `app/(main)/stores/[id]/page.tsx` → store-detail-tabs(基本情報 / 補足 / AI 分析タブ)。BasicInfoCard(編集 form)、WebAssetCard、AiAnalysisDetailSection(ai_analysis_result 表示・再実行 = 営業資産生成ボタンの着地先候補)。ai_analysis_result の read/write は約 16 箇所。
- `lib/queries/stores.ts` getStoreCached / listAllStoresCached、`lib/queries/deep-research.ts` getDeepResearchReport
- `lib/cache.ts` CACHE_TAGS.store(id) / stores → **basic_info は自動カバー、新規タグ不要**

## 2. Requirement-to-Asset Map

| 要件 | 既存資産 | 扱い | Gap (Missing/Unknown/Constraint) |
|---|---|---|---|
| R1 最小必須 | createStoreAction(name 検証) | 流用 | — |
| R2 51 項目保持・可視化 | stores / types / DEEP_RESEARCH_ITEMS / DeepResearchReportView | 改修+新規 | basic_info 型(Missing)、欠落 1 項目(Missing/D7)、表示 UI(改修) |
| R3 エリア検索充填 | placeResultToStoreInput, bulkAddStoresFromPlacesAction | 改修 | Place→basic_info マッピング(Missing) |
| R4 AI リサーチ取込 | structureFromPastedMarkdownAction, structurer | 改修 | 構造化出力→basic_info マージ(Missing) |
| R5 競合解決 | store-repository.update(原子性) | 流用足場+新規 | primary 定義 / mergeBasicInfo 純関数(Missing) |
| R6 手動編集保護 | BasicInfoCard, updateStorePatchAction | 改修 | filled_by=manual 記録・保護判定(Missing) |
| R7 営業資産生成 | ai-analysis-actions, research-paste-actions, buildAnalysisPrompt | 統合新規 | generateSalesAssetsAction, buildBasicInfoBlock(Missing) |
| R8 移行 | 0008(jsonb 前例), 0011(UPDATE 前例), update 原子性 | 新規 | backfill script(Missing/前例消失), スカラー DROP(Constraint: 本番直結 + 孤児マイグレ常習) |

## 3. Implementation Approach Options

### Option A: Extend(既存拡張のみ)
basic_info を StoreInput に足し、updateStorePatch / BasicInfoCard を拡張。
- ✅ 最小ファイル、updateStorePatch が型レベルで自動対応 ／ ❌ 競合マージ・プロンプト統合・生成集約が既存 actions / Card を肥大化

### Option B: New(専用層新設)
basic_info 専用の repository / action / 型 / UI を独立新設。
- ✅ 関心分離・テスト容易 ／ ❌ store と二重の取得経路、Repository 単一窓口原則(structure.md)に反する

### Option C: Hybrid(**推奨 = grill D1–D8**)
- データ層は **extend**(stores に jsonb 列、toDbRow/fromDbRow に basic_info、update の原子性を流用)
- マージ・プロンプト・生成は **new**(mergeBasicInfo 純関数 / buildBasicInfoBlock / generateSalesAssetsAction)
- 移行は **expand-contract 3PR**
- ✅ 既存パターン(Repository 単一窓口 / ActionResult / CACHE_TAGS)を尊重、段階移行で本番リスク分散 ／ ❌ 計画調整コスト、PR1–2 間で ai_analysis_result と basic_info が併存

## 4. Effort / Risk(領域別)

| 領域 | Effort | Risk | 根拠 |
|---|---|---|---|
| データモデル(D1/D2 列+型) | S | Low | jsonb 前例 0008、update 原子性流用 |
| 競合マージ(D3) | M | Medium | 新規純関数、primary 定義要、テスト基盤なし |
| エリア検索充填(R3) | M | Medium | Place→basic_info キーマッピング設計 |
| AI リサーチ統合(R4/D4) | M | Low–Med | structurer 流用 + マージ追加 |
| プロンプト/生成統合(D5/D6) | M | Medium | buildBasicInfoBlock 新規、2 アクション統合(出力契約は #113 据置でリスク減) |
| 移行 backfill(D8) | L | High | 本番直結 DB、backfill script 前例消失、スカラー DROP 不可逆、孤児マイグレ常習 |
| UI(R2/R6) | M | Medium | 51 項目フォーム化、BasicInfoCard 再構成 |
| **全体** | **L–XL** | **Medium–High** | 複数 PR + 本番移行 |

## 5. Recommendations for Design Phase

**Preferred approach:** Option C(Hybrid / grill D1–D8)。

**Key decisions(design で確定):**
- basic_info の型(BasicInfoField + キー = BASIC_INFO_ITEMS、DEEP_RESEARCH_ITEMS を母体に)
- primary マッピング(places 優先 = 住所/営業時間/座標/電話/口コミ/業態/サイト、ai 優先 = owner/競合/市場系)
- Place→basic_info キーマッピング(placeResultToStoreInput の再設計 or 並行ヘルパ)
- backfill アルゴリズム(既存スカラー + 最新 report → basic_info、address の都道府県/市区/番地分解の逆変換)
- expand-contract の各 PR 境界とロールバック手順

**Research Needed(design/実装で解消):**
- 欠落 1 項目の特定(Issue #43 §2 ↔ schema.ts)
- backfill 実行環境(本番直結のため CI migrate + backfill 手順、生成 SQL レビューで孤児マイグレ回避)
- PR1–PR2 間の ai_analysis_result ↔ basic_info 併存中の整合
- 旧スカラー参照の全箇所棚卸し(DROP 前: BasicInfoCard / WebAssetCard / area-search / queries / 約 16 箇所の ai_analysis_result 類似)
- テスト基盤なし(pnpm typecheck/lint/build のみ) → mergeBasicInfo 等の純関数検証方針
- ai_analysis_result 列の存続/廃止(D6 で生成入力は basic_info、出力保存先は据置か)

---

## Design Synthesis (2026-06-07)

### Generalization
- 3 充填ソース(places/ai/manual)を「部分 basic_info を 1 ソースとしてマージ」に一般化 → `mergeBasicInfo(current, incoming, source)` 単一合流点。新ソース追加も同インターフェースで吸収。
- 各項目を `BasicInfoField`(value + meta)に一般化し、ソース固有形式(PlaceResult / StructuredReport)は converter で吸収。

### Build vs Adopt
- **Adopt**: store-repository.update の原子性パターン、structurer、buildAnalysisPrompt / AiAnalysisResult / validateAiAnalysis、DEEP_RESEARCH_ITEMS、CACHE_TAGS、Drizzle jsonb(`.$type<T>()`)。
- **Build(最小)**: mergeBasicInfo、placeResultToBasicInfo、structuredReportToBasicInfo、buildBasicInfoBlock、generateSalesAssetsAction、BASIC_INFO_ITEMS(primary 付与)、store-repository.mergeBasicInfo。
- **Reject**: 楽観ロック(version check) — 既存 last-write-wins で十分(read-merge-write を 1 文脈で実行)。ソース別候補保持(D2 で却下)。自動 cron 復活(D4 却下)。

### Simplification
- 単一値 + メタ(ソース別候補を持たない)。
- 営業資産出力は据置(#113)、本 spec は入力統一に集中。
- `.$type<T>()` は新規 basic_info 列のみ採用、既存 jsonb 列の遡及適用は後続技術債。
- マージは repository に専用メソッド(`mergeBasicInfo`)を 1 つ足すのみ。汎用 `update` を肥大化させない。

### Research Needed (design → 実装へ持ち越し)
- 欠落 1 項目の特定(Issue #43 §2 ↔ schema.ts)。
- backfill の address 逆分解精度・実行環境(本番直結のため dry-run → 適用)。
- vitest 導入可否(純関数中心のため費用対効果高、別判断)。
