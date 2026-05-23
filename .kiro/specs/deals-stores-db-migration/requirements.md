# Requirements Document

## Introduction

社内営業ツール **FirstWeb - Reserch AI for Sales** の商談 (Deal) と店舗 (Store) のデータを、現在のインメモリ Mock 実装から **実 DB を用いた永続化レイヤ** へ移行する。サーバー再起動後もデータが保持され、複数ユーザー間で共有可能になり、ダッシュボード / KPI / パイプラインの集計が実データに基づいて動作することを目的とする。既存の Server Actions / `'use cache'` クエリ / Cache タグ戦略 / Repository 抽象は無修正で動作させ、Mock 実装は環境変数によるフォールバックとして残す。

## Project Description (Input)

**起票元**: [GitHub Issue #1 — feat(deals): 商談・店舗管理を Supabase + Drizzle で実 DB 化](https://github.com/ManatoYamashita/fw-sales/issues/1)

### 誰が困っているか (Who)
- **社内営業チーム / マネージャー / プランナー**: 商談 (Deal) と店舗 (Store) のデータを実運用で蓄積・共有したい利用者
- **開発チーム / 運用担当**: 「実アプリとして動作する商談管理」を提供する責務を負うエンジニア

### 現状 (Current Situation)
- 商談 (Deal) と店舗 (Store) のデータは `lib/mock/db.ts` のインメモリ Map + `globalThis` 永続化で保持
- サーバー再起動でデータが消失する
- 複数端末・複数ユーザー間でデータを共有できない
- ダッシュボード / KPI / パイプラインといった集計画面がリアルなデータに紐付かない

### 何を変えるか (What Should Change)
- Deal と Store を実 DB に永続化し、`lib/repositories/index.ts` の `repos.deal` / `repos.store` を実 DB 実装へ差し替える
- Server Actions / `'use cache'` クエリ / Cache タグ戦略は無修正で動作させる
- 既存 Mock 実装は削除せず、環境変数 `USE_MOCK_DB=true` で従来モードに戻せるようにする (ローカル開発・E2E 用)

## Boundary Context

- **In scope**:
  - Deal / Store の CRUD と永続化
  - Deal ↔ Store の関連 (`store_id` 参照整合)
  - 商談ステータスと店舗ステージの同期 (`受注` 等)
  - SEED データの初期投入
  - Export / Import / Reset の Deal / Store 部分の DB 経路対応
  - Mock フォールバックモード切替 (`USE_MOCK_DB`)

- **Out of scope** (別 Issue):
  - Research / Handoff の DB 化
  - 認証・認可 (`assigned_sales` を user_id に切替えるリファクタ)
  - リアルタイム同期 / 行レベルセキュリティ
  - 画像など外部ストレージ連携

- **Adjacent expectations** (本 Issue が依存・前提とする近接領域):
  - **Cache Components 戦略**: 既存の `'use cache'` + `cacheTag` + `revalidateTag(tag, "max")` の stale-while-revalidate 規約を継続して機能させる責任は本 Issue 側
  - **Server Actions の API 形状**: `createDealAction` / `updateDealAction` / `deleteDealAction` のシグネチャは外部契約として維持
  - **Repository 抽象**: `lib/repositories/*-repository.ts` の interface は無修正で満たす
  - **既存 UI**: 商談・店舗・ダッシュボード・KPI・パイプライン画面側の変更は本 Issue の責務外 (ただし永続化されたデータが反映されること自体は本 Issue の責務)

## Requirements

### Requirement 1: 商談・店舗データの永続化
**Objective:** 営業担当者として、商談・店舗データがサーバー再起動を跨いで保持され、複数端末で共有されることを望む。これにより、社内ツールとして実運用に耐える状態に到達できる。

#### Acceptance Criteria
1. When 営業担当者が商談または店舗を作成・更新・削除する, the FirstWeb shall その変更を実 DB に永続化する。
2. When サーバープロセスが再起動される, the FirstWeb shall 直前までに永続化された商談・店舗データを引き続き読み出せる状態で起動する。
3. When 別端末・別ユーザーが同一データにアクセスする, the FirstWeb shall 全端末に対し同一の最新状態を返す。
4. While 永続化処理が進行中, the FirstWeb shall 該当データに対する後続の読み出し要求に対し、整合の取れた状態 (永続化前 or 永続化後) のいずれかを返す (中間状態を返さない)。

### Requirement 2: 商談 CRUD と画面表示
**Objective:** 営業担当者として、商談一覧・新規作成・詳細表示・編集・削除が永続化データに対して動作することを望む。これにより、業務フロー全体を実データで完結できる。

#### Acceptance Criteria
1. When 営業担当者が `/deals` 画面を開く, the FirstWeb shall 全商談を永続化レイヤから取得し、`created_at` 降順で一覧表示する。
2. When 営業担当者が `/stores/{storeId}` 画面を開く, the FirstWeb shall 該当店舗に紐付く商談のみを抽出して表示する。
3. When 営業担当者が新規商談フォームに必須項目を入力し保存する, the FirstWeb shall 入力値で新しい商談を永続化し、ID を発番する。
4. When 営業担当者が商談の編集を保存する, the FirstWeb shall 変更を永続化し、関連する一覧・集計を最新化する。
5. When 営業担当者が商談を削除する, the FirstWeb shall 該当商談を永続化レイヤから取り除き、関連する一覧・集計から除外する。

### Requirement 3: 商談ステータスと店舗ステージの整合性
**Objective:** 営業マネージャとして、商談ステータス (受注 / 失注 / 見積提出 / 継続追客) の更新時に、対応する店舗ステージが自動同期され、両者の整合性が常に保たれることを望む。

#### Acceptance Criteria
1. When 営業担当者が商談を「受注」「失注」「見積提出」「継続追客」のいずれかのステータスで保存する, the FirstWeb shall 既定のマッピングに従い、該当店舗のステージを同期して永続化する。
2. When 商談の作成または更新と、それに伴う店舗ステージの同期が同一の保存処理に含まれる, the FirstWeb shall 両方の永続化を一つの不可分な単位として扱う。
3. If 商談の作成・更新と店舗ステージ同期のいずれか一方が失敗する, the FirstWeb shall いずれの変更も永続化せず、エラーを呼び出し元に返す。

### Requirement 4: 集計・ダッシュボードへの反映
**Objective:** マネージャとして、ダッシュボード / KPI / パイプラインの集計が永続化データに基づき、データ変更後も新しい集計が次回読み出しまでに反映されることを望む。

#### Acceptance Criteria
1. The FirstWeb shall ダッシュボード / KPI / パイプライン / アクションキューの全集計を、永続化された商談・店舗データに基づき算出する。
2. When 商談の作成・更新・削除が成功する, the FirstWeb shall 影響範囲のキャッシュタグ (`deals` / `deal:{id}` / `dealsByStore:{storeId}` / `stores` / `store:{id}` / `stats` / `kpi` / `pipeline` / `action-queue`) を失効させる。
3. When 上記の集計画面が再描画される, the FirstWeb shall 失効後に最新の永続化データから集計を取得し表示する。

### Requirement 5: Mock フォールバックモード
**Objective:** 開発者・QA として、ローカル開発や E2E 検証時に永続化レイヤを用いず、従来 Mock のみで完結したい。これにより、外部 DB 接続なしで開発・検証を行える。

#### Acceptance Criteria
1. Where 環境変数 `USE_MOCK_DB` が `"true"` に設定されている, the FirstWeb shall 永続化レイヤとしてインメモリ Mock 実装を選択する。
2. Where 環境変数 `USE_MOCK_DB` が未設定 または `"true"` 以外, the FirstWeb shall 永続化レイヤとして実 DB 実装を選択する。
3. When Mock モードで `pnpm dev` を実行する, the FirstWeb shall 既存の Mock 実装と同等の振る舞い (SEED 適用 / globalThis 永続化) を提供する。
4. The FirstWeb shall Mock モードと DB モードの切替を起動時に決定し、リクエスト処理中に切替えない。

### Requirement 6: 起動時の接続検証
**Objective:** 運用担当として、必要な接続設定が欠落しているとき、起動時点で明確に失敗してほしい。これにより、無効な状態でリクエストを受け付ける事故を避けられる。

#### Acceptance Criteria
1. When DB モードで起動し、データベース接続に必要な環境変数が欠落している, the FirstWeb shall 起動を中断し、不足項目を明記したエラーを標準エラー出力に表示する。
2. If DB モードで起動時に DB 接続が確立できない, the FirstWeb shall 起動を中断し、原因 (接続不可 / 認証失敗 / タイムアウト等) を含むエラーを出力する。
3. The FirstWeb shall データベース接続情報を環境変数経由でのみ受け取る。
4. The FirstWeb shall データベース接続情報および認証クレデンシャルを、Client Component のバンドルに含めない。

### Requirement 7: SEED データの再現性
**Objective:** 開発者として、開発環境・QA 環境を SEED から再構築でき、Mock と DB の双方で同一データを再現できることを望む。これにより、環境差分による不具合を最小化できる。

#### Acceptance Criteria
1. When 開発者が SEED 投入手順を実行する, the FirstWeb shall 既存 Mock の SEED (`SEED_STORES` / `SEED_DEALS`) と同等の内容を永続化レイヤに投入する。
2. When 既存データがある状態で SEED を再投入する, the FirstWeb shall 一意キーの競合を避け、ベキ等な挙動 (再投入後の状態が一意に決まる) を提供する。
3. The FirstWeb shall SEED 投入手順を環境変数 `USE_MOCK_DB` の値に応じて、Mock と DB の正しい一方に対して実行する。

### Requirement 8: データ移送 (Export / Import / Reset)
**Objective:** 管理者として、永続化レイヤ越しでも既存の Export / Import / Reset 機能を継続利用したい。これにより、バックアップと初期状態への復元が引き続き行える。

#### Acceptance Criteria
1. When 管理者が Settings 画面から Export を実行する, the FirstWeb shall 永続化されている商談・店舗データを JSON 形式でダウンロード可能にする。
2. When 管理者が Import を実行し、商談・店舗を含む JSON を投入する, the FirstWeb shall 投入データを永続化レイヤに upsert する。
3. When 管理者が Reset を実行する, the FirstWeb shall 商談・店舗データを SEED 初期状態に戻す。
4. When DB モードで Export / Import / Reset を実行する, the FirstWeb shall Research / Handoff 部分は従来 Mock 由来の値を、Deal / Store 部分は永続化レイヤ由来の値を扱う。
5. When Mock モードで Export / Import / Reset を実行する, the FirstWeb shall 全エンティティを従来通り Mock 越しに扱う。

### Requirement 9: 既存 API 契約の後方互換性
**Objective:** 開発者として、既存 Server Action / `'use cache'` クエリ / Cache タグ戦略 / Repository interface のいずれも無修正で動作することを望む。これにより、UI 層・上位ロジックを変更せずに永続化レイヤだけを差し替えられる。

#### Acceptance Criteria
1. The FirstWeb shall 既存の `createDealAction` / `updateDealAction` / `deleteDealAction` / `createStoreAction` / `updateStoreAction` / `deleteStoreAction` のシグネチャと戻り値型を維持する。
2. The FirstWeb shall 既存の `'use cache'` クエリ (`listDealsCached` / `getDealCached` / `listStoresCached` 等) のシグネチャを維持する。
3. The FirstWeb shall 既存の Cache タグキー (`lib/cache.ts` の `CACHE_TAGS` 定数) を変更しない。
4. The FirstWeb shall データソースへのアクセスを `lib/repositories/index.ts` の `repos` 経由のみに限定する (上位レイヤから Mock または DB 実装を直接 import しない)。
5. While 永続化レイヤを差し替えている間, the FirstWeb shall 既存の `StoreFilter` / `DealInput` / `DealPatch` 等の型契約を満たす。

### Requirement 10: ID と日付項目の互換性
**Objective:** 開発者として、既存の表示処理・ID 生成ロジックを変更せずに永続化できることを望む。これにより、UI / 表示ユーティリティへの波及を防ぐ。

#### Acceptance Criteria
1. The FirstWeb shall 商談・店舗の主キーを `<entity>_<id>` 形式の文字列 (例: `deal_001`) として扱い、`generateId` 由来の値を継続使用する。
2. The FirstWeb shall `created_at` / `updated_at` を `YYYY-MM-DD` 形式の文字列として扱い、UI 表示処理の変更を不要とする。
3. When 商談を作成する, the FirstWeb shall `store_id` が永続化レイヤに存在しない場合は作成を拒否し、エラーを返す。

### Requirement 11: 動作検証 (Acceptance Test)
**Objective:** 検証担当として、リリース前の標準的な検証手順が完結することを望む。

#### Acceptance Criteria
1. When 検証担当が `pnpm typecheck` / `pnpm lint` / `pnpm build` を順に実行する, the FirstWeb shall 全コマンドがエラーなく完了する。
2. When 検証担当が DB モードで以下の E2E を実行する, the FirstWeb shall 各ステップで期待動作を示す:
   1. `/stores/{storeId}` から新規商談を作成し「受注」で保存
   2. プロセスを再起動
   3. `/deals` で当該商談が残存していることを確認
   4. `/stores/{storeId}` で該当店舗の `stage` が「受注」に同期されていることを確認
   5. `/dashboard` / `/kpi` / `/pipeline` で受注金額・件数が集計に反映されていることを確認
3. When 検証担当が `USE_MOCK_DB=true` で再起動し同等の操作を行う, the FirstWeb shall 従来 Mock モードと同等の振る舞いを示す。
