# Requirements Document

> **Re-baseline 注記 (2026-06-13)**: 本書策定後、兄弟 spec `store-basic-info` が #114(`basic_info` jsonb 一本化)/ #121(ワークベンチ単線化・Stage2 構造化撤去・生成集約)を**完遂**した。これに伴い以下を現 main へ再整合する(詳細は tasks.md 冒頭):
> - **状態は 4→3**(`未調査` / `調査可` / `生成済`)。`調査取込済` は貼付テキストが永続化されない(生成時に瞬間的に渡すのみ)ため検出信号が無く**縮退**。R1 の状態集合・R2 の状態別 CTA はこの 3 状態で読む。
> - **状態信号**は `basic_info` の充足(`filled_by!==null`)+ `ai_analysis_result` の有無。旧 `full_markdown` / `research_reports` 信号は撤去済。R4 のコア充足は `basic_info` のコアキー(primary="places" から `store_name` を除く 6 項目: address/cuisine_genre/business_hours_holidays/official_site/location_feature/nearest_station)で評価し、旧スカラー列の空文字 sentinel は不要。
> - **R4 の充足閾値は「過半(3/5)」→「コア 2 項目」へ是正**(E2E 実測)。エリア検索の自動充填が埋めるコアは `address`+`cuisine_genre` の 2 項目のため、閾値 3 では標準フロー「エリア検索→調査可」が成立しない。R4.3/4.4 の「3 項目以上/過半」は本注記の「2 項目以上」で読み替える。
> - **生成集約・死蔵 cron CTA 撤去は store-basic-info が完了済**。本 spec の該当言及(#114 非依存 / 死蔵 CTA 抑止)は「既達」として読む。
> - **STEP0 の調査プロンプト**は新規ヘルパを起こさず既存 `buildBasicInfoBlock`(`lib/ai/basic-info-prompt.ts`)を再利用。

## Project Description (Input)

**対象ユーザー(誰):** fw-sales を使う営業担当者。

**現状(課題):** 店舗を追加した後、ユーザーが「次に何をすればいいか」が分からない。一般的な利用フローは `エリア検索から追加(Places で基本情報充填) → DeepResearch(基本情報サマリのプロンプトを作り専用 Gem(Gemini GUI)で実行し 51 項目を充填) → 得られた full_markdown を貼付し Gemini API で強み・弱み・架電スクリプトを生成` の 3 段だが、各段の入口が分散し、特に「Gem に渡す調査プロンプトを作る」段は当システムに UI が無く手作業になっている。フローは多少ズレる(例: エリア検索でなく食べログ URL から登録して調査に入る)が、標準フローを「誰でも何も考えず迷わず一本道で歩ける」ための画面遷移・誘導が存在しない。

**変えるべきこと(What should change):** 店舗詳細を主導線とし、各店舗の「調査フェーズ」を状態として可視化したうえで、その状態に応じた「今やるべき唯一のアクション」を単一の CTA として提示する。調査開始の CTA からは、店舗の基本情報サマリを 1 クリックでコピーでき、設定済みの Gem を開ける導線(貼付ワークベンチの STEP0)へ遷移する。STEP0(プロンプト生成・コピー/Gem 起動) → STEP1(貼付・構造化) → STEP3(営業資産生成)が同一ワークベンチ内で連続して完了できるようにする。これにより、どの経路で追加された店舗も同じ状態機械・CTA に乗り、標準フローを迷わず辿れるようにする。

**確定設計(grill-me で D1–D12 を策定済み / GitHub Issue #122 / memory `store_flow_guidance_issue`):**
- **D1 Issue 配置:** 新規 Issue #122。データモデル再設計 #114・架電出力契約 #113・エリア検索 #103/#104・貼付移行 #105 を依存/参照とする。本文空の #101「UI の見直し」は #122 に吸収しクローズ済み。
- **D2 中核 UX:** 状態機械 × 単一 CTA。調査フェーズは営業ステージ(`stage`)とは別軸(データ充足の進み具合)。
- **D3 状態集合:** 4 状態(中間なし)。未調査 / 調査可 / 調査取込済 / 生成済。外部 Gem への往復は状態化せず、同一画面の連続 CTA で処理する。
- **D4 #114 非依存:** `basic_info`(jsonb, #114 で新設予定)の完成を待たず、現行スキーマ(調査結果の有無 / `ai_analysis_result` の有無)から状態を導出する。#114 マージ後に導出ロジックを `basic_info` 参照へ差し替える。
- **D5 状態境界(未調査↔調査可):** 基本情報の充足率。空文字 `""` / `0` を「未充足」と判定(調査系列は `NOT NULL default ""` のため NULL では判定不可)。コア 5 項目 = `address` / `genre` / `phone` / `business_hours` / `review_count > 0`。`name` 必須に加えコア 5 項目の過半(3/5 以上)が非空なら「調査可」。
- **D6 調査プロンプトの中身:** 基本情報サマリのみ(Gem 側が調査指示・51 項目スキーマ・A/B/C・出典規則を保持する前提)。既存 `lib/ai/deep-research/prompt.ts` の Stage1 は死蔵 cron 用で流用しない。
- **D7 スコープ境界:** 加筆のみ・既存画面に配線。状態バッジ + 単一 CTA + 調査プロンプトコピー/Gem 導線の追加に留め、生成の店舗詳細への集約・`/stores/new`「AI で分析」廃止は #114(D6/Req7)に委ねる。
- **D8 逸脱エントリパス:** 動線上の互換保証のみ。どの経路で追加された店舗も同じ状態機械・CTA に乗る。食べログ URL 取込等の新規登録機能はスコープ外(別 Issue)。
- **D9 出現面:** 店舗詳細に一点集中。店舗一覧の状態バッジ列 / 追加直後の即誘導 / グローバル滞留通知は将来拡張。
- **D10 プロンプト UI 置き場:** 貼付ワークベンチ(`/research/[storeId]`)の STEP1 の手前に「STEP0: 調査プロンプトを生成・コピー + Gem を開く」を新設。店舗詳細の調査開始 CTA はここへ遷移。
- **D11 Gem リンク:** 設定画面(`settings`)で管理。「Gem URL」項目を追加し DB 保存。STEP0 の「Gem を開く」はこの URL を開く。
- **D12 #121 リスク対応:** #121(Stage2 構造化を生成経路から撤去・「貼付=自由形式プロンプト直渡し」へ転換)が「調査取込済」の判定信号を脅かすため、状態導出を `getStoreResearchPhase(store)` 単一ヘルパに隠蔽し、信号を差し替え可能にする。ゲートせず進める。

**制約:**
- `.env.local` の `DATABASE_URL` は本番 Supabase 直結。migrate は CI 任せ・ローカル実行厳禁。
- Drizzle 孤児マイグレーション常習。生成 SQL は必ずレビューし純粋差分に手修正。
- 複数セッションが同一リポジトリを並行操作。スコープ所有権の重複(特に #114)を侵さない。

**未決(design で確定):** Gem URL の永続化機構(既存 `settings` の保存方式 / 新規テーブル要否) / コア充足率判定の正確な対象列と sentinel 扱い / `getStoreResearchPhase` の信号定義(#121 着地後の差し替え方針) / 基本情報サマリ生成の入力範囲と整形 / 状態バッジ・CTA の店舗詳細上の配置(`store-title-section` か `store-detail-tabs` か)。

**関連:** #122(本仕様) / #114(データモデル・生成集約、非依存だが将来差し替え) / #113(架電出力契約) / #103・#104(エリア検索) / #105(貼付ワークベンチ) / #110(旧 cron 廃止) / #121(状態判定信号の依存リスク) / #101(吸収・クローズ済)。

## Introduction

本機能は、店舗を追加した後の営業担当者を「追加 → DeepResearch → 架電スクリプト生成」の標準フローに沿って迷わず誘導する。各店舗の調査フェーズ(未調査 / 調査可 / 調査取込済 / 生成済)を店舗詳細に可視化し、その状態に対応する「今やるべき唯一のアクション」を単一の CTA として提示する。調査開始の CTA は、店舗の基本情報サマリのコピーと専用 Gem(外部 Gemini GUI)の起動を備えた貼付ワークベンチの入口(STEP0)へ繋がり、貼付・構造化・営業資産生成までが同一ワークベンチ内で連続して完了できる。

本書は user-observable な振る舞い(WHAT)を定義する。状態導出ヘルパの内部構造・Gem URL の永続化方式・基本情報サマリの整形(HOW)は design フェーズで扱う。

## Boundary Context

- **In scope**: 各店舗の調査フェーズ(4 状態)の現行スキーマからの導出 / 店舗詳細での状態バッジ表示 / 状態別の「今やるべき唯一のアクション」を単一 CTA として提示 / 未調査↔調査可をコア項目の充足率で判定 / 貼付ワークベンチへの STEP0(調査プロンプト=基本情報サマリの生成・コピー、Gem 起動)新設 / STEP0→STEP1→STEP3 の連続完了 / 設定画面での Gem URL 管理 / どの登録経路の店舗も同じ状態機械・CTA に乗る互換保証
- **Out of scope**: 基本情報の `basic_info`(jsonb) 単一真実化・複数ソース充填・競合解決(#114 が所有) / 営業資産生成の店舗詳細への集約・`/stores/new`「AI で分析」廃止(#114 が所有) / 架電 Gemini の出力項目構成(#113 が所有) / 食べログ URL 等からの新規登録機能(別 Issue) / 店舗一覧の状態列・グローバル滞留通知・追加直後の即誘導(将来拡張) / 自動 DeepResearch パイプライン(cron)の復活(廃止済 #110) / 当システム内での DeepResearch 一貫実行(将来構想)
- **Adjacent expectations**: エリア検索(#103/#104)が Places 由来の基本情報を充填し充足率に寄与する / 貼付ワークベンチ(#105)が STEP1(構造化)・STEP3(架電生成)を所有する / #114 が将来 `basic_info` を提供し状態導出の信号源を置き換える / #121 が貼付経路の構造化有無を変更し「調査取込済」の判定信号に影響する / #113 が STEP3 で生成される営業資産の項目構成を所有する

## Requirements

### Requirement 1: 調査フェーズの導出と可視化
**Objective:** As a 営業担当者, I want 各店舗が標準フローのどこにいるかを店舗詳細で一目で把握できること, so that 次に何をすべきか考えずに済む

#### Acceptance Criteria
1. The Store Flow Guidance System shall 各店舗について調査フェーズを「未調査 / 調査可 / 調査取込済 / 生成済」の 4 状態のいずれか 1 つに分類する
2. The Store Flow Guidance System shall 店舗詳細ページに当該店舗の調査フェーズを状態バッジとして表示する
3. The Store Flow Guidance System shall 調査フェーズを営業ステージ(`stage`)とは独立した軸として扱い、両者を混同して表示しない
4. When 営業資産(`ai_analysis_result`)が存在する, the Store Flow Guidance System shall 当該店舗を「生成済」に分類する
5. When 営業資産が未生成で調査結果が取込済である, the Store Flow Guidance System shall 当該店舗を「調査取込済」に分類する

### Requirement 2: 状態別の単一次アクション
**Objective:** As a 営業担当者, I want その店舗で今やるべき唯一のアクションを大きく提示してほしい, so that 迷わず次の一手を実行できる

#### Acceptance Criteria
1. The Store Flow Guidance System shall 店舗詳細に、現在の調査フェーズに対応する「今やるべき唯一のアクション」を単一の CTA として提示する
2. Where 調査フェーズが「未調査」である, the Store Flow Guidance System shall 基本情報を補う導線(編集 / エリア検索再取得)を主アクションとして提示する
3. Where 調査フェーズが「調査可」である, the Store Flow Guidance System shall 調査開始(貼付ワークベンチ STEP0 への遷移)を主アクションとして提示する
4. Where 調査フェーズが「調査取込済」である, the Store Flow Guidance System shall 営業資産生成(貼付ワークベンチ STEP3 への遷移)を主アクションとして提示する
5. Where 調査フェーズが「生成済」である, the Store Flow Guidance System shall 結果の確認・再生成を主アクションとして提示する

### Requirement 3: 現行スキーマからの状態導出(#114 非依存)
**Objective:** As a 開発者, I want 状態導出を `basic_info`(#114) の完成を待たずに現行データで実現したい, so that 動線改善を先行して提供でき将来の信号差し替えにも耐える

#### Acceptance Criteria
1. The Store Flow Guidance System shall 調査フェーズを現行スキーマ(調査結果の有無 / `ai_analysis_result` の有無 / コア項目の充足率)から導出する
2. The Store Flow Guidance System shall 調査フェーズの導出を単一のヘルパ(`getStoreResearchPhase`)に集約し、判定の信号源を 1 箇所で差し替え可能とする
3. The Store Flow Guidance System shall `basic_info`(jsonb, #114) の存在を状態導出の前提としない

### Requirement 4: 充足率による未調査↔調査可の判定
**Objective:** As a 営業担当者, I want 基本情報が乏しいうちは補完を促し、十分埋まったら調査開始を促してほしい, so that 痩せた調査プロンプトを避けつつ無駄な足踏みもしない

#### Acceptance Criteria
1. The Store Flow Guidance System shall コア 5 項目(`address` / `genre` / `phone` / `business_hours` / `review_count`)の充足を評価する
2. The Store Flow Guidance System shall 空文字(`""`)および `0`(`review_count`)を「未充足」として扱う
3. When `name` が充足し、かつコア 5 項目のうち過半(3 項目以上)が非空である, the Store Flow Guidance System shall 当該店舗を(調査結果が未取込であれば)「調査可」に分類する
4. If コア 5 項目の充足が過半未満である, then the Store Flow Guidance System shall 当該店舗を(調査結果が未取込であれば)「未調査」に分類する
5. The Store Flow Guidance System shall `name` のみが充足された店舗についても調査開始の実行自体は妨げない

### Requirement 5: 調査開始導線(STEP0)とプロンプト/Gem 連携
**Objective:** As a 営業担当者, I want 調査開始時に店舗の基本情報サマリを 1 クリックでコピーし専用 Gem を開きたい, so that 外部 Gemini での DeepResearch にすぐ取りかかれる

#### Acceptance Criteria
1. The Store Flow Guidance System shall 貼付ワークベンチ(`/research/[storeId]`)の貼付・構造化(STEP1)の手前に STEP0(調査プロンプトの生成・コピーと Gem 起動)を提供する
2. When 営業担当者が STEP0 でコピーを実行する, the Store Flow Guidance System shall 当該店舗の基本情報サマリ(店名・住所・業態・電話・URL 等)をクリップボードにコピーする
3. The Store Flow Guidance System shall STEP0 で生成する調査プロンプトを基本情報サマリに限定し、51 項目の調査指示・出典規則は含めない(Gem 側が保持する前提)
4. When 営業担当者が STEP0 で Gem を開く操作を実行する, the Store Flow Guidance System shall 設定済みの Gem URL を開く
5. When 営業担当者が店舗詳細の「調査可」CTA を実行する, the Store Flow Guidance System shall 当該店舗の STEP0 へ遷移する

### Requirement 6: ワークベンチ内での連続完了
**Objective:** As a 営業担当者, I want プロンプト生成から貼付・構造化・営業資産生成までを同じ画面で続けて行いたい, so that 外部往復後も動線を見失わない

#### Acceptance Criteria
1. The Store Flow Guidance System shall STEP0(プロンプト生成・コピー/Gem 起動) → STEP1(貼付・構造化) → STEP3(営業資産生成)を同一ワークベンチ内で連続して実行可能とする
2. The Store Flow Guidance System shall STEP0 の追加によって既存の STEP1・STEP3 の機能を損なわない

### Requirement 7: 登録経路に依らない動線互換
**Objective:** As a 営業担当者, I want エリア検索以外で追加した店舗でも同じ誘導に乗りたい, so that 登録方法を問わず標準フローを辿れる

#### Acceptance Criteria
1. The Store Flow Guidance System shall 登録経路(エリア検索 / 手動登録)に依らず、全ての店舗を同一の状態機械・CTA で扱う
2. When 手動登録された店舗がコア項目を充足していない, the Store Flow Guidance System shall 当該店舗を「未調査」から開始し、充足率に応じて「調査可」へ昇格させる

### Requirement 8: Gem URL の設定管理
**Objective:** As a 運用担当者, I want 専用 Gem へのリンクをノーコードで設定・変更したい, so that 再デプロイなしにチーム共通リンクを維持できる

#### Acceptance Criteria
1. The Store Flow Guidance System shall 設定画面で Gem URL を保存・変更できる
2. The Store Flow Guidance System shall 設定された Gem URL を STEP0 の「Gem を開く」操作で使用する
3. If Gem URL が未設定である, then the Store Flow Guidance System shall STEP0 でその旨を示し、コピー等の他の操作を妨げない
