# Requirements Document

## Introduction

社内営業ツール **Firstweb Lead OS** の調査 (Research) と引き継ぎ (Handoff) のデータを、現在のインメモリ Mock 実装から実 DB を用いた永続化レイヤへ移行する。これにより Issue #1 (`deals-stores-db-migration`) で確立した Stores / Deals の永続化と整合し、Wave 1「基盤完成」を完結させる。

サーバー再起動後もデータが保持され、複数ユーザー間で共有可能になり、ダッシュボード / KPI / アクションキュー / 引き継ぎ一覧の集計が Research / Handoff まで含めた実データに基づいて動作することを目的とする。既存の Server Actions / `'use cache'` クエリ / Cache タグ戦略 / Repository 抽象は無修正で動作させ、Mock 実装は環境変数によるフォールバックとして残す。

## Project Description (Input)

**起票元**: [GitHub Issue #2 — feat(research-handoff-db): Research/Handoff の DB 永続化](https://github.com/ManatoYamashita/fw-sales/issues/2)

### 誰が困っているか (Who)
- **調査担当 / 営業担当 / 運用担当**: 調査結果と引き継ぎシートを実運用で蓄積・共有したい利用者
- **マネージャ**: ダッシュボード / KPI / アクションキューの集計を Research / Handoff まで含めた実データで確認したい意思決定者
- **開発・運用担当**: Stores / Deals だけ DB 化されているが Research / Handoff のみ Mock のまま残っている整合性の崩れを解消したいエンジニア

### 現状 (Current Situation)
- `lib/repositories/index.ts:96-99` で DB モードでも `repos.research = mockResearchRepo` / `repos.handoff = mockHandoffRepo` のままになっており、コメントで「別 Issue で DB 化される予定」と明記されている
- `lib/db/schema.ts` には `stores` / `deals` のみ定義され、Research / Handoff のテーブルは未定義
- `lib/actions/data-actions.ts` の Reset / Import / Export は DB モード時も Research / Handoff だけを Mock 経由で操作する例外コードが残存
- 結果として、サーバー再起動で Research / Handoff データが消失し、複数端末・複数ユーザー間でデータを共有できず、Export / Import の整合性も二系統に分かれる

### 何を変えるか (What Should Change)
- Research と Handoff を実 DB に永続化し、`lib/repositories/index.ts` の `repos.research` / `repos.handoff` を実 DB 実装へ差し替える
- Server Actions / `'use cache'` クエリ / Cache タグ戦略 / Repository interface は無修正で動作させる
- 既存 Mock 実装は削除せず、環境変数 `USE_MOCK_DB=true` で従来モードに戻せるようにする
- Issue #1 (`deals-stores-db-migration`) で確立した永続化基盤・Repository 切替仕組み・トランザクション API を再利用し、新規の永続化アーキテクチャは導入しない

## Boundary Context

- **In scope**:
  - Research / Handoff の CRUD と永続化
  - Research → Store の参照整合 (`store_id`)
  - Handoff → Store / Deal の参照整合 (`store_id`, `deal_id`)
  - 調査保存時の Store ステージ (`調査待ち` → `調査完了`) およびチャネルの同期
  - 引き継ぎ作成時の Store ステージ (`引き継ぎ待ち`) 同期
  - 引き継ぎ完了時のステータス遷移 (`運用確認待ち` → `完了`)
  - SEED データ (`SEED_RESEARCH` / `SEED_HANDOFFS`) の永続化レイヤへの投入
  - Export / Import / Reset の Research / Handoff 部分を永続化レイヤ越しに統一(現存する Mock 限定の例外コードを排除)
  - 既存 Mock フォールバックモード (`USE_MOCK_DB=true`) を維持

- **Out of scope** (別 Issue):
  - 認証・認可 (`researcher` / `contract_owner` / `ops_assignee` を `user_id` に切替えるリファクタ — #3)
  - アクション履歴の独立テーブル化 (#4)
  - 添付ファイル (契約書 PDF / 店舗写真) 管理 (#9)
  - 期日リマインダー / 通知 (#8)
  - 行レベルセキュリティの本格設定
  - マルチテナント対応 (#12)
  - 既存 UI 画面の改修 (フォーム・一覧の見た目変更)

- **Adjacent expectations** (本 Issue が依存・前提とする近接領域):
  - **Stores / Deals 永続化レイヤ (#1 完了済)**: 本 Issue は #1 で確立した永続化基盤、`repos` 切替仕組み、`repos.transaction()` API、起動時の接続検証、`USE_MOCK_DB` セマンティクスを前提として動作する。本 Issue では新規の永続化アーキテクチャは追加しない
  - **Cache Components 戦略**: 既存の `'use cache'` + `cacheTag(CACHE_TAGS.research / researchByStore / handoffs / handoff / handoffsByStore)` + `revalidateTag(tag, "max")` 規約を継続して機能させる責任は本 Issue 側
  - **Server Actions の API 形状**: `saveResearchAction` / `saveResearchAndContinue` / `createHandoffAction` / `updateHandoffAction` / `completeHandoffAction` / `deleteHandoffAction` のシグネチャと戻り値型は外部契約として維持
  - **Repository 抽象**: `lib/repositories/research-repository.ts` / `lib/repositories/handoff-repository.ts` の interface は無修正で満たす
  - **既存 UI**: Research / Handoff フォーム・一覧画面側の変更は本 Issue の責務外。ただし永続化されたデータが各画面に正しく反映されること自体は本 Issue の責務

## Requirements

### Requirement 1: Research / Handoff データの永続化

**Objective:** 調査担当・営業担当として、調査結果と引き継ぎシートがサーバー再起動を跨いで保持され、複数端末で共有されることを望む。これにより、社内ツールとして実運用に耐える状態に到達できる。

#### Acceptance Criteria
1. When 調査担当または営業担当が調査または引き継ぎを作成・更新・削除する, the Lead OS shall その変更を実 DB に永続化する。
2. When サーバープロセスが再起動される, the Lead OS shall 直前までに永続化された調査・引き継ぎデータを引き続き読み出せる状態で起動する。
3. When 別端末・別ユーザーが同一データにアクセスする, the Lead OS shall 全端末に対し同一の最新状態を返す。
4. While 永続化処理が進行中, the Lead OS shall 該当データに対する後続の読み出し要求に対し、整合の取れた状態 (永続化前 or 永続化後) のいずれかを返す (中間状態を返さない)。

### Requirement 2: 調査 (Research) の取得・保存・削除

**Objective:** 調査担当として、調査の取得・保存・更新・削除が永続化データに対して動作することを望む。これにより、調査業務を実データで完結できる。

#### Acceptance Criteria
1. When 調査担当が `/research/{storeId}` 画面を開く, the Lead OS shall 該当店舗に紐付く調査 (1 店舗 1 調査) を永続化レイヤから取得し表示する。
2. When 調査担当が調査フォームを保存し、該当店舗の既存調査が存在する, the Lead OS shall 既存調査を更新として永続化する。
3. When 調査担当が調査フォームを保存し、該当店舗の既存調査が存在しない, the Lead OS shall 新規調査として ID を発番し永続化する。
4. When 調査担当が調査を削除する, the Lead OS shall 該当調査を永続化レイヤから取り除き、関連する一覧・集計から除外する。
5. If 調査の `store_id` に対応する店舗が永続化レイヤに存在しない, the Lead OS shall 調査の作成または更新を拒否し、エラーを呼び出し元に返す。

### Requirement 3: 引き継ぎ (Handoff) の取得・作成・更新・完了・削除

**Objective:** 営業担当・運用担当として、引き継ぎシートの作成・編集・完了・削除が永続化データに対して動作することを望む。これにより、受注後の運用引き継ぎを実データで完結できる。

#### Acceptance Criteria
1. When 営業担当または運用担当が `/handoffs` 画面を開く, the Lead OS shall 全引き継ぎを永続化レイヤから取得し、`created_at` 降順で一覧表示する。
2. When 担当者が `/handoffs/{handoffId}` 画面を開く, the Lead OS shall 該当の引き継ぎを永続化レイヤから取得し表示する。
3. When 担当者が店舗 ID を指定して引き継ぎ一覧を取得する, the Lead OS shall 該当店舗に紐付く引き継ぎのみを抽出して返す。
4. When 営業担当が新規引き継ぎフォームを保存する, the Lead OS shall 入力値で新しい引き継ぎを永続化し、ID を発番する。
5. When 担当者が引き継ぎの編集を保存する, the Lead OS shall 変更を永続化し、関連する一覧・集計を最新化する。
6. When 運用担当が引き継ぎを「完了」ステータスへ遷移させる, the Lead OS shall ステータス遷移を永続化し、関連する集計を最新化する。
7. When 担当者が引き継ぎを削除する, the Lead OS shall 該当引き継ぎを永続化レイヤから取り除く。
8. If 引き継ぎの `store_id` または `deal_id` に対応するレコードが永続化レイヤに存在しない, the Lead OS shall 引き継ぎの作成を拒否し、エラーを呼び出し元に返す。

### Requirement 4: 状態遷移と店舗ステージ・チャネルの整合性

**Objective:** マネージャとして、Research/Handoff の状態遷移時に対応する Store ステージ・チャネルが自動同期され、両者の整合性が常に保たれることを望む。これにより、パイプライン上の状態が常に一致する。

#### Acceptance Criteria
1. When 調査担当が調査を保存し、該当店舗のステージが「調査待ち」, the Lead OS shall 店舗のステージを「調査完了」へ更新する。
2. When 調査担当が調査を保存する, the Lead OS shall 入力された channel を該当店舗の `channel` に同期して永続化する。
3. When 営業担当が引き継ぎを新規作成する, the Lead OS shall 該当店舗のステージを「引き継ぎ待ち」へ同期して永続化する。
4. When Research/Handoff の作成または更新と、それに伴う店舗ステージ・チャネルの同期が同一の保存処理に含まれる, the Lead OS shall 全ての永続化を一つの不可分な単位として扱う。
5. If Research/Handoff 側または店舗側のいずれか一方の永続化が失敗する, the Lead OS shall いずれの変更も永続化せず、エラーを呼び出し元に返す。

### Requirement 5: 集計・キャッシュ整合性

**Objective:** マネージャ・運用担当として、Research/Handoff 関連の集計 (アクションキュー / 引き継ぎ件数 / KPI ファネル) が永続化データに基づき、データ変更後も新しい集計が次回読み出しまでに反映されることを望む。

#### Acceptance Criteria
1. The Lead OS shall アクションキュー / 引き継ぎ一覧 / KPI ファネル / ダッシュボード Research セクションの全集計を、永続化された Research / Handoff データに基づき算出する。
2. When Research/Handoff の作成・更新・削除・完了が成功する, the Lead OS shall 影響範囲のキャッシュタグ (`research` / `researchByStore:{storeId}` / `handoffs` / `handoff:{id}` / `handoffsByStore:{storeId}` / `stores` / `store:{id}` / `stats` / `kpi` / `action-queue`) を失効させる。
3. When 上記の画面が再描画される, the Lead OS shall 失効後に最新の永続化データから集計を取得し表示する。

### Requirement 6: Mock フォールバックモード

**Objective:** 開発者・QA として、ローカル開発や E2E 検証時に永続化レイヤを用いず、Mock のみで完結することを望む。これにより、外部 DB 接続なしで開発・検証を行える。

#### Acceptance Criteria
1. Where 環境変数 `USE_MOCK_DB` が `"true"` に設定されている, the Lead OS shall Research / Handoff の永続化レイヤとしてインメモリ Mock 実装を選択する。
2. Where 環境変数 `USE_MOCK_DB` が未設定 または `"true"` 以外, the Lead OS shall Research / Handoff の永続化レイヤとして実 DB 実装を選択する。
3. The Lead OS shall Research / Handoff のモード切替判定を Stores / Deals と同一の単一窓口で行い、エンティティごとの不一致を生じさせない。
4. The Lead OS shall Mock モードと DB モードの切替を起動時に決定し、リクエスト処理中に切替えない。
5. When Mock モードで `pnpm dev` を実行する, the Lead OS shall 既存の Mock 実装と同等の振る舞い (SEED 適用 / globalThis 永続化 / 1 店舗 1 調査制約) を提供する。

### Requirement 7: SEED データの再現性

**Objective:** 開発者として、SEED から Research / Handoff を含む全環境を再構築でき、Mock と DB の双方で同一データを再現できることを望む。これにより、環境差分による不具合を最小化できる。

#### Acceptance Criteria
1. When 開発者が SEED 投入手順を実行する, the Lead OS shall 既存 Mock の `SEED_RESEARCH` / `SEED_HANDOFFS` と同等の内容を永続化レイヤに投入する。
2. When 既存データがある状態で SEED を再投入する, the Lead OS shall 一意キーの競合を避け、ベキ等な挙動 (再投入後の状態が一意に決まる) を提供する。
3. The Lead OS shall SEED 投入を、参照先 (`stores` / `deals`) の永続化が完了してから参照元 (`research` / `handoffs`) を投入する順序で実行し、参照整合性違反を発生させない。
4. The Lead OS shall SEED 投入手順を `USE_MOCK_DB` の値に応じて、Mock と DB の正しい一方に対して実行する。

### Requirement 8: データ移送 (Export / Import / Reset) の統一

**Objective:** 管理者として、Export / Import / Reset を Research / Handoff も含めた全エンティティに対して永続化レイヤ越しで統一的に動作させることを望む。これにより、現状残っている「DB モード時に Research / Handoff だけ Mock 経由」という例外が排除される。

#### Acceptance Criteria
1. When 管理者が DB モードで Export を実行する, the Lead OS shall Stores / Deals / Research / Handoff の全データを永続化レイヤから取得して JSON 形式で出力する。
2. When 管理者が DB モードで Import を実行し、Research / Handoff を含む JSON を投入する, the Lead OS shall Research / Handoff 部分も永続化レイヤに upsert する。
3. When 管理者が DB モードで Reset を実行する, the Lead OS shall Research / Handoff も含む全エンティティを SEED 初期状態に戻す。
4. When 管理者が DB モードで Export / Import / Reset を実行する, the Lead OS shall Research / Handoff の処理経路として Mock を経由しない。
5. The Lead OS shall Import / Reset を複数エンティティ間で参照整合 (Handoff → Deal / Store, Research → Store) を保つよう不可分な単位で実行する。
6. When Mock モードで Export / Import / Reset を実行する, the Lead OS shall 全エンティティを従来通り Mock 越しに扱う。

### Requirement 9: 既存 API 契約の後方互換性

**Objective:** 開発者として、既存 Server Action / `'use cache'` クエリ / Cache タグ / Repository interface のいずれも無修正で動作することを望む。これにより、UI 層・上位ロジックを変更せずに永続化レイヤだけを差し替えられる。

#### Acceptance Criteria
1. The Lead OS shall 既存の `saveResearchAction` / `saveResearchAndContinue` / `createHandoffAction` / `updateHandoffAction` / `completeHandoffAction` / `deleteHandoffAction` のシグネチャと戻り値型を維持する。
2. The Lead OS shall Research / Handoff 関連の `'use cache'` クエリ (`lib/queries/research.ts` / `lib/queries/handoffs.ts`) のシグネチャを維持する。
3. The Lead OS shall 既存の Cache タグキー (`CACHE_TAGS.research` / `CACHE_TAGS.researchByStore` / `CACHE_TAGS.handoffs` / `CACHE_TAGS.handoff` / `CACHE_TAGS.handoffsByStore`) を変更しない。
4. The Lead OS shall データソースへのアクセスを `lib/repositories/index.ts` の `repos` 経由のみに限定する (上位レイヤから Mock または DB 実装を直接 import しない。例外として `lib/actions/data-actions.ts` の Export / Import / Reset 処理は引き続き特権処理として両系統に直接触れることを許容する)。
5. While 永続化レイヤを差し替えている間, the Lead OS shall 既存の `ResearchInput` / `ResearchPatch` / `HandoffInput` / `HandoffPatch` 等の型契約を満たす。

### Requirement 10: ID と日付項目およびスキーマの互換性

**Objective:** 開発者として、既存の表示処理・ID 生成ロジック・型定義を変更せずに永続化できることを望む。これにより、UI / 表示ユーティリティへの波及を防ぐ。

#### Acceptance Criteria
1. The Lead OS shall Research / Handoff の主キーを `<entity>_<id>` 形式の文字列 (例: `res_001`, `hand_001`) として扱い、`generateId` 由来の値を継続使用する。
2. The Lead OS shall `created_at` / `updated_at` を `YYYY-MM-DD` 形式の文字列として扱い、UI 表示処理の変更を不要とする。
3. The Lead OS shall `Handoff.payment_confirmed` を nullable 文字列 (`null` 許容) として扱い、未確認状態を `null` で表現可能にする。
4. The Lead OS shall ステータス・チャネル等の列挙値を文字列として保存し、列挙の妥当性は Action 層 / 型ガードで検証する。
5. When 子エンティティ (Research / Handoff) の永続化時に親エンティティ (Store / Deal) の存在制約を満たさない, the Lead OS shall 永続化を拒否しエラーを返す。

### Requirement 11: トランザクション境界の拡張

**Objective:** 開発者として、Issue #1 で確立した `repos.transaction(fn)` API が Research / Handoff も含めた書き込みに対応することを望む。これにより、複数エンティティを跨ぐ整合性をトランザクションで保証できる。

#### Acceptance Criteria
1. The Lead OS shall `repos.transaction(fn)` のコールバック引数に Research / Handoff を含むリポジトリ集合を提供する。
2. When `repos.transaction(fn)` 配下で Research / Handoff の書き込みと Store / Deal の書き込みを行う, the Lead OS shall 全書き込みを 1 つのトランザクション境界内で実行し、いずれかの失敗時にすべての変更を巻き戻す。
3. While Mock モードで動作する間, the Lead OS shall `repos.transaction(fn)` を擬似実装として直列実行のみで提供し、ロールバックは行わない (既存の Mock トランザクション規約と同一)。

### Requirement 12: 動作検証 (Acceptance Test)

**Objective:** 検証担当として、リリース前の標準的な検証手順で Research / Handoff の永続化が確認できることを望む。

#### Acceptance Criteria
1. When 検証担当が `pnpm typecheck` / `pnpm lint` / `pnpm build` を順に実行する, the Lead OS shall 全コマンドがエラーなく完了する。
2. When 検証担当が DB モードで以下の E2E を実行する, the Lead OS shall 各ステップで期待動作を示す:
   1. `/research/{storeId}` で調査を保存し、店舗ステージが「調査完了」に、チャネルが入力値に同期されることを確認
   2. `/deals` で受注済み商談から `/handoffs/new?dealId={dealId}` を開き、引き継ぎを作成し、店舗ステージが「引き継ぎ待ち」になることを確認
   3. 該当の引き継ぎを「完了」ステータスに更新
   4. プロセスを再起動
   5. `/research/{storeId}` および `/handoffs` で先ほど作成・更新したデータが残存していることを確認
   6. `/dashboard` / `/kpi` / `/pipeline` で Research / Handoff の集計に反映されていることを確認
3. When 検証担当が `USE_MOCK_DB=true` で再起動し同等の操作を行う, the Lead OS shall 従来 Mock モードと同等の振る舞いを示す。
4. When 検証担当が DB モードで Settings 画面から Export / Import / Reset を実行する, the Lead OS shall Research / Handoff も含む全エンティティが永続化レイヤ越しに統一的に処理され、現状の Mock 経由の例外コードが排除されていることを確認できる状態にある。
