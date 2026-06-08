# Requirements Document

## Project Description (Input)

> **2026-06-08 改訂(#121 整合)**: 当初 grill で策定した D1–D8 のうち、**Stage 2 構造化を生成入力にする前提(D4 および R2/R4 の構造化充填)を撤去**した。#121「生成経路から Stage 2 構造化を撤去し、貼付テキスト(自由形式プロンプト)+ 基本情報で生成する」に整合させ、本 spec は **basic_info 基盤(Places/手動充填) + 生成統合** に縮小する。下記要求はこの縮小後の確定版。

**対象ユーザー(誰):** fw-sales を使う営業担当者。

**現状(課題):** 店舗の基本情報が `stores` のフラットなスカラー列と別テーブル `research_reports` に分散している。営業資産生成(強み・弱み・架電)の入力経路も新規登録時の AI 分析と調査後の貼付生成の 2 つに割れている。51 項目は店舗の一級市民でなく、複数ソースで段階充填する仕組みも出典・確信度・上書きルールも存在しない。加えて、貼付フローには重い Stage 2 構造化が残置し不安定の元凶になっている(#77 / #121)。

**変えるべきこと(What should change):** 店舗の基本情報 51 項目を `stores.basic_info`(jsonb) に単一セットとして保持し、エリア検索(Places)・手動入力で「埋められるだけ埋める」。各項目は value + 取得区分(A/B/C) + 確信度 + 出典 + 取得ソース(filled_by) を持ち、項目別優先ソースと「手動値は不可侵」で競合を解決する。営業資産生成は店舗詳細の単一操作に集約し、入力を **`basic_info`(充足項目) + 調査結果の自由形式テキスト(構造化しない)** に統一する。生成は Stage 2 構造化(`structurer`)を経由しない。移行は本番直結 DB のため expand-contract で段階実施する。

**確定設計(grill D1–D8 を #121 整合に縮小):**
- D1 器(維持): `stores.basic_info jsonb`。営業管理スカラー存続、調査系スカラーは段階 DROP。
- D2 項目形(維持): 単一値 + メタ `{value,tier,confidence,source_urls,source_quote,hearing_question,filled_by,updated_at}`。
- D3 競合(維持・2 ソース): 項目別 primary、手動不可侵。ソースは places / manual。
- ~~D4 AI リサーチ構造化充填~~ (**削除**): Stage 2 構造化を生成経路から撤去(#121)。調査結果は basic_info を充填せず生成プロンプトへ自由形式で渡す。
- D5 プロンプト(維持・拡張): `buildBasicInfoBlock`(充足項目のみ)+ 貼付自由テキストを生成入力に。
- D6 生成統合(維持): `generateSalesAssetsAction` 1 本・店舗詳細集約。
- ~~D7 51 補完~~ (優先度低下): 構造化撤去により AI 充填が無く、51 枠は保持するが充足は Places/手動に限定。
- D8 移行(維持・縮小): expand-contract。backfill は既存スカラーのみ(research_reports からの充填は行わない)。

**制約:** `.env.local` は本番 Supabase 直結(migrate は CI 任せ)。Drizzle 孤児マイグレ常習(生成 SQL 必須レビュー)。

**関連:** #121(生成の Stage2 撤去・本 spec の前提変更元) / #114(縮小リライト対象) / #113(出力契約) / #110(孤児 cron・構造化資産撤去) / #105(手動貼付) / #43/#102/#77。

## Introduction

本機能は、fw-sales の各店舗が「8 カテゴリ 51 項目の基本情報(`basic_info`)」を単一セットで保持し、エリア検索・手動入力で段階充填し、充足済みの基本情報と調査結果の自由形式テキストを入力として営業資産(強み・弱み・架電スクリプト)を生成できるようにする。生成は Stage 2 構造化を経由しない(#121)。

本書は user-observable な振る舞い(WHAT)を定義する。データ構造・移行手順・内部実装(HOW)は design フェーズで扱う。

## Boundary Context

- **In scope**: 店舗が 51 項目の基本情報を単一セットで保持 / エリア検索(Places)・手動による充填 / 複数ソース競合時の値決定(手動保護・項目別 primary) / 取得区分・確信度・出典・取得ソース・未充足の可視化 / 充足済み基本情報 + 調査結果テキストを入力とした営業資産生成の店舗詳細への集約 / 既存スカラー情報の移行
- **Out of scope**: 貼付テキストの Stage 2 構造化(#121 で生成経路から撤去) / `research_reports`・`structurer` を生成に用いること / 営業資産の出力項目構成の見直し(#113) / 自動 Deep Research cron(#110 で撤去) / `basic_info` への AI 構造化充填(将来・別途) / 営業管理項目の変更
- **Adjacent expectations**: エリア検索機能(#108/#117)が店舗候補と公開地図情報を供給する / 外部 AI(手動実行)が調査結果テキストを供給する(#105 / #121 の貼付経路) / 架電 Gemini の出力契約(#113)が営業資産の項目構成を所有する

## Requirements

### Requirement 1: 店舗登録の最小必須項目
**Objective:** As a 営業担当者, I want 店舗名だけで素早く店舗を登録できること, so that 残りの基本情報を後から段階的に充填できる

#### Acceptance Criteria
1. When 営業担当者が店舗を新規登録する, the Store Basic Info System shall 店舗名のみを必須とし、その他の基本情報が未入力でも登録を完了する
2. If 店舗名が空のまま登録が試みられる, then the Store Basic Info System shall 登録を拒否し、店舗名が必須である旨を通知する
3. The Store Basic Info System shall 登録直後の店舗について、未入力の基本情報項目を「未充足」として保持する

### Requirement 2: 基本情報 51 項目の保持と可視化
**Objective:** As a 営業担当者, I want 店舗ごとに 8 カテゴリ 51 項目の基本情報を確認し各値の確からしさと出典を把握できること, so that 営業準備の判断材料を画面 1 つで把握できる

#### Acceptance Criteria
1. The Store Basic Info System shall 各店舗について 8 カテゴリ 51 項目の基本情報の枠を保持する
2. The Store Basic Info System shall 各項目に取得難易度区分(A / B / C)を付与して表示する
3. Where 項目区分が B である, the Store Basic Info System shall 当該項目の確信度・出典・出典抜粋を表示する
4. Where 項目区分が C である, the Store Basic Info System shall 当該項目に店主への確認質問を表示する
5. If ある項目が未充足である, then the Store Basic Info System shall 当該項目を空欄のまま放置せず「未充足」として可視化する
6. The Store Basic Info System shall 各項目について値を充填した取得ソース(エリア検索 / 手動)を表示する

### Requirement 3: エリア検索からの自動充填
**Objective:** As a 営業担当者, I want エリア検索から店舗を登録する際に公開情報で埋まる項目を自動充填してほしい, so that 手入力の手間を減らせる

#### Acceptance Criteria
1. When 営業担当者がエリア検索の結果から店舗を登録する, the Store Basic Info System shall 公開地図情報から取得可能な基本情報項目(店舗名・住所・業態・営業時間・電話番号・口コミ評価等)を充填する
2. The Store Basic Info System shall エリア検索で充填した各項目の取得ソースを「エリア検索」として記録する
3. If エリア検索で取得できない項目がある, then the Store Basic Info System shall 当該項目を未充足のまま残す

### Requirement 4: 調査結果テキストの取り込みと生成入力化
**Objective:** As a 営業担当者, I want 外部 AI で実施した店舗調査の結果テキストを取り込んで生成に使いたい, so that 公開情報では届かない深い文脈を営業資産に反映できる

#### Acceptance Criteria
1. When 営業担当者が調査結果テキストを店舗の調査画面に入力する, the Store Basic Info System shall 当該テキストを自由形式の生成入力として保持する
2. The Store Basic Info System shall 調査結果テキストを Stage 2 構造化(項目 JSON 化)を経由せずそのまま生成プロンプトに供給する
3. If 調査結果テキストが空である, then the Store Basic Info System shall 基本情報のみを用いて営業資産生成を実行可能とする

### Requirement 5: 複数ソースの競合解決
**Objective:** As a 営業担当者, I want 複数ソースが同じ項目を埋めても信頼できる値が保たれ自分の手入力が機械に消されないでほしい, so that データの信頼性と手作業の成果が守られる

#### Acceptance Criteria
1. If ある項目が手動で編集された値を持つ, then the Store Basic Info System shall その後のエリア検索による自動充填で当該項目を上書きしない
2. When 複数の取得ソースが同じ項目を充填しうる, the Store Basic Info System shall 当該項目に定められた優先ソースの値を採用して表示する
3. Where ある自動ソースが当該項目の優先ソースでない, the Store Basic Info System shall 当該項目が未充足のときに限り補完する

### Requirement 6: 手動編集と値の保護
**Objective:** As a 営業担当者, I want 任意の基本情報項目を直接編集でき, その値が保持されること, so that 検索が誤った値を確定値で上書きできる

#### Acceptance Criteria
1. When 営業担当者が基本情報項目を手動で編集する, the Store Basic Info System shall 当該項目の値を保存し、取得ソースを「手動」として記録する
2. The Store Basic Info System shall 手動編集された項目を以後の自動充填に対して保護する

### Requirement 7: 営業資産(強み・弱み・架電スクリプト)の生成
**Objective:** As a 営業担当者, I want 店舗詳細から 1 つの操作で基本情報と調査結果テキストをもとに営業資産を生成したい, so that 入口を探さず一貫した品質で営業準備ができる

#### Acceptance Criteria
1. When 営業担当者が店舗詳細で営業資産の生成を実行する, the Store Basic Info System shall その店舗の充足済み基本情報と入力済み調査結果テキストを用いて営業資産(強み・弱み・グルメサイト課金状況・GBP 充実度・架電スクリプト・確信度)を生成する
2. The Store Basic Info System shall 店舗名のみが充足された状態でも営業資産の生成を実行可能とする
3. The Store Basic Info System shall 営業資産生成において Stage 2 構造化(`structurer` / 項目 JSON 化)を呼び出さない
4. The Store Basic Info System shall 営業資産の生成を店舗詳細上の単一の操作に集約する
5. When 営業資産が生成される, the Store Basic Info System shall 生成結果を店舗に保存し、再表示および再生成を可能とする

### Requirement 8: データ移行と既存情報の保全
**Objective:** As a 既存の営業担当者, I want 移行後も既存店舗の情報が失われないでほしい, so that これまでの蓄積を継続利用できる

#### Acceptance Criteria
1. The Store Basic Info System shall 移行に際し、既存店舗のスカラー基本情報(住所・業態・営業時間・口コミ等)を新しい基本情報セットへ引き継ぐ
2. The Store Basic Info System shall 移行の前後で、営業担当者が参照できる店舗情報の連続性を保つ
3. The Store Basic Info System shall 既存の調査結果(`research_reports`)を生成経路に再接続しない(構造化撤去、#121)
