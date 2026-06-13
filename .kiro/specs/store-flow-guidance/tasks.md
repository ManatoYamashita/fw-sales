# Implementation Plan

> **Re-baseline 2026-06-13**: 兄弟 spec `store-basic-info` が #114(basic_info 一本化)/ #121(ワークベンチ単線化・Stage2 撤去・生成集約)を**完遂**したため、当初前提を現 main へ再整合した。主な変更: (1) 状態信号は `basic_info` の充足 + `ai_analysis_result` の有無(旧 `full_markdown` / `research_reports` は撤去済)。(2) **4→3 状態**(`調査取込済` は貼付テキストが永続化されないため検出不能=縮退)。(3) 死蔵 `deep-research-enqueue-button` は store-basic-info task 4.2 で**既に撤去済**のため抑止タスク不要。(4) STEP0 の調査プロンプトは新規 `buildBasicInfoSummary` を起こさず既存 `buildBasicInfoBlock`(`lib/ai/basic-info-prompt.ts`)を再利用。
> PR 分割: 動線可視化(純関数 + バッジ + CTA)= **PR1(完了)**、Gem 連携(app_settings + STEP0 + 設定 UI)= PR2。自動テストは vitest(純関数)+ typecheck/lint + 手動 E2E。

- [x] 1. Foundation: 状態導出と純関数 (PR1)
- [x] 1.1 調査フェーズ型・充足判定・コア充足数の純関数を実装する
  - `ResearchPhase`(`untouched` / `ready` / `generated`)を定義。`isBasicInfoFieldFilled`(`filled_by!==null` かつ value 非空白)と `filledCoreCount`(コアキーの充填数)を実装。コアキー = `BASIC_INFO_ITEMS` の primary="places" から `store_name` を除く 6 項目(`CORE_BASIC_INFO_KEYS`)
  - 完了条件: 空文字 / 空白 / `filled_by===null` / undefined を未充足と判定する境界が vitest で確認できる
  - _Requirements: 4.1, 4.2_
  - _Boundary: store-research-phase(filledCoreCount)_
- [x] 1.2 状態導出の純関数を実装する
  - `getStoreResearchPhase(store)`: `ai_analysis_result` 非 null → `generated` / `filledCoreCount >= READY_CORE_THRESHOLD(3)` → `ready` / else → `untouched`。`Pick<Store, "ai_analysis_result"|"basic_info">` を受ける純関数。登録経路に依らず同一信号で判定
  - 完了条件: 3 状態の境界(ai 有/無 × コア 3 前後)が vitest で確認でき、`ai_analysis_result` 非 null で必ず `generated`
  - _Requirements: 1.1, 1.4, 1.5, 3.1, 3.3, 4.3, 4.4, 7.1, 7.2_
  - _Boundary: store-research-phase(getStoreResearchPhase)_
  - _Depends: 1.1_
- [x] 1.3 状態別の表示メタ(バッジ + CTA)を整備する
  - `RESEARCH_PHASE_META`: 各状態に badge ラベル・tone と単一 CTA(label / href / variant / hint)を定義。untouched→「基本情報を入力」(`/stores/[id]?tab=basic`) / ready→「調査して生成」(`/research/[storeId]`) / generated→「営業資産を再生成」(`/research/[storeId]`)
  - 完了条件: 全 3 状態に badge と CTA(遷移先)が定義され、網羅性が vitest で確認できる
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
  - _Boundary: store-research-phase(RESEARCH_PHASE_META)_

- [x] 2. 店舗詳細への状態提示 (PR1)
- [x] 2.1 調査フェーズバッジを実装する
  - 3 状態の `ResearchPhaseBadge`(Badge tone: warning/info/success)。cron 用 `research-status-badge` とは別物
  - 完了条件: 3 状態が区別可能なバッジとして描画される
  - _Requirements: 1.2_
  - _Boundary: ResearchPhaseBadge_
  - _Depends: 1.3_
- [x] 2.2 状態別単一 CTA を実装する
  - `NextActionCta`: `RESEARCH_PHASE_META[phase].cta` を `buttonVariants` 適用の `Link` で描画(Button は asChild 非対応)。hint があれば下に添える
  - 完了条件: 現在状態に対応する単一の主アクションが描画され遷移先が正しい
  - _Requirements: 2.1, 1.3_
  - _Boundary: NextActionCta_
  - _Depends: 1.3_
- [x] 2.3 店舗詳細でフェーズを算出し提示を結線する
  - `stores/[id]/page.tsx` で `getStoreResearchPhase(store)` を算出し、`StoreTitleSection` に `phase` を渡してバッジ + CTA をマウント。追加 query なし(既存 `getStoreCached` を流用)
  - 完了条件: typecheck/lint 通過。店舗詳細にバッジと単一 CTA が表示され、状態が現行データから導出される
  - _Requirements: 1.1, 1.2, 2.1, 3.1, 3.2_
  - _Boundary: store-title-section, stores/[id]/page_
  - _Depends: 2.1, 2.2_
- [x] 2.4 ~~死蔵 cron CTA の表示抑止~~ → **削除(不要)**
  - store-basic-info task 4.2(PR3a)で `DeepResearchSection` / `deep-research-enqueue-button` / `getDeepResearchReport` が既に撤去済。店舗詳細は `StoreTitleSection + StoreDetailTabs` のクリーン構成で、抑止対象が存在しない

- [ ] 3. Gem URL 永続化基盤 (PR2)
- [ ] 3.1 app_settings テーブルを追加する
  - key-value 設定テーブル(`key` PK / `value` NOT NULL / `updated_at`)を `lib/db/schema.ts` に定義し次番号(現 main の最新 idx を確認の上)マイグレーションを作成。既存列は汚さず独立テーブル。生成 SQL は孤児マイグレ混入を避け目視レビュー・純粋差分に手修正、CI で適用
  - 完了条件: マイグレーションが CI で適用され `app_settings` が存在する
  - _Requirements: 8.1_
  - _Boundary: app_settings(schema)_
- [ ] 3.2 app_settings リポジトリを実装する
  - `get(key)` / `set(key,value)`(upsert)を実装し `repos.appSettings` に登録。予約キー `deep_research_gem_url`
  - 完了条件: get/set 往復で永続化され、再保存が upsert される
  - _Requirements: 8.1_
  - _Boundary: app-settings-repository_
  - _Depends: 3.1_
- [ ] 3.3 Gem URL の query と action を実装する
  - `getGemUrlCached()`(`'use cache'` + 新設 `CACHE_TAGS.appSettings`、`lib/cache.ts` 規約準拠)と `setGemUrlAction(url)`(認証必須 / http(s) 最小検証 / 保存後 `revalidateTag`)
  - 完了条件: query で保存値が読め、action で保存・再検証、不正 URL は失敗で既存値不変
  - _Requirements: 8.1, 8.2_
  - _Boundary: getGemUrlCached, setGemUrlAction_
  - _Depends: 3.2_

- [ ] 4. STEP0 と設定 UI の結線 (PR2)
- [ ] 4.1 設定画面に Gem URL カードを追加する
  - `GemUrlCard`(入力 + 保存 = `setGemUrlAction`)を `settings/page.tsx` の `AiPromptTemplatesCard` 隣にマウント
  - 完了条件: 設定で Gem URL を保存・変更でき、再訪時に保存値が表示される
  - _Requirements: 8.1, 8.2_
  - _Boundary: GemUrlCard, settings/page_
  - _Depends: 3.3_
- [ ] 4.2 ワークベンチに STEP0 を前置する
  - `ResearchPromptStep`(調査プロンプト表示 = 既存 `buildBasicInfoBlock(store.basic_info)` を再利用 + 「プロンプトをコピー」= 既存 `onCopy` + 「Gem を開く」= `gemUrl` を新規タブ)を `paste-workbench.tsx` の貼付欄の手前に**非破壊**でマウント。`gemUrl` 未設定時は注記しコピーは可能
  - 完了条件: STEP0 でプロンプトがコピーでき設定済み Gem URL が開く。既存の貼付→生成が損なわれない。未設定でもコピー可
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 6.1, 6.2, 8.3_
  - _Boundary: ResearchPromptStep, paste-workbench(前置のみ)_
  - _Depends: 3.3_
- [ ] 4.3 ワークベンチページで Gem URL を供給する
  - `research/[storeId]/page.tsx` で `getGemUrlCached()` を取得し `PasteWorkbench` へ `gemUrl` を渡す。`buildBasicInfoBlock` は store.basic_info から算出して供給
  - 完了条件: STEP0 に正しいプロンプトと Gem URL が供給される
  - _Requirements: 5.1, 5.5, 6.1_
  - _Boundary: research/[storeId]/page_
  - _Depends: 4.2_

> ~~5. #121 整合ゲート~~ → **削除**: #121 は store-basic-info 経由で着地済み。貼付テキストは永続化されず `researched` 状態は検出不能のため 3 状態へ縮退済(1.2 に反映)。信号差替えは完了状態。
