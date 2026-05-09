# Implementation Plan — research-handoff-db-migration

> 本タスクリストは `requirements.md`(12 Requirements / 47 サブ ID)と `design.md` のコンポーネント・契約・整合性決定を、実装可能な単位(1〜3 時間目安)に分解したものである。`(P)` マーク付きのタスクは並行実行可能、`_Depends:_` は順序由来でない非自明な依存を示す。
>
> **本 spec の位置付け**: `#1 deals-stores-db-migration` で確立された永続化基盤(`lib/db/client.ts` / `lib/env.ts` / `drizzle.config.ts` / `package.json` の依存)をそのまま再利用する。**新規ライブラリ追加なし**。本 spec が触るのは Schema / Repository / Composition / Action tx 化 / データ移送統合の 5 領域に限定。

---

## Phase 1: Foundation — Schema 拡張とマイグレーション生成

- [ ] 1. research / handoffs テーブルスキーマと migration

- [x] 1.1 research / handoffs のテーブルスキーマを定義
  - `lib/db/schema.ts` に `pgTable("research", {...})` を追記、`types/research.ts` の 22 フィールドに 1:1 対応
  - `pgTable("handoffs", {...})` を追記、`types/handoff.ts` の 18 フィールドに 1:1 対応
  - `research.store_id` に `references(() => stores.id)` で FK 制約(NOT NULL)
  - `handoffs.store_id` に `references(() => stores.id)`、`handoffs.deal_id` に `references(() => deals.id)` で FK 制約(両 NOT NULL)
  - `handoffs.payment_confirmed` のみ `text("payment_confirmed")`(`.notNull()` 無し)で nullable
  - 列挙型(`ResearchStatus` / `HandoffStatus` / `Channel`)は Postgres ENUM 化せず `text` で保持
  - `created_at` / `updated_at` は `text` (`YYYY-MM-DD` 文字列)
  - 既存 `stores` / `deals` 定義は無修正
  - 観測可能な完了状態: スキーマファイルが import できるテストモジュールから `research.store_id` / `handoffs.deal_id` の型が正しく推論され、`pnpm typecheck` がエラーなく完了する
  - _Requirements: 1.1, 2.5, 3.8, 10.1, 10.2, 10.3, 10.4, 10.5_
  - _Boundary: lib/db/schema.ts_

- [x] 1.2 research/handoffs マイグレーション SQL を生成しコミット
  - `pnpm drizzle-kit generate` で `drizzle/0001_<auto>.sql` を自動生成
  - 生成 SQL に `CREATE TABLE research (...)` / `CREATE TABLE handoffs (...)` および 3 つの FK 制約 (`research.store_id`、`handoffs.store_id`、`handoffs.deal_id`) が含まれること
  - `drizzle/meta/_journal.json` を含めて git に追加
  - 既存 `0000_living_darwin.sql` は無修正
  - 観測可能な完了状態: `drizzle/0001_*.sql` がリポジトリに存在し、SQL を Postgres で実行すると 2 テーブルが作成され FK 制約が動作する
  - _Depends: 1.1_
  - _Requirements: 1.1_
  - _Boundary: drizzle/_

---

## Phase 2: Core — Repository 実装

- [ ] 2. Drizzle ベースの ResearchRepository / HandoffRepository

- [x] 2.1 (P) ResearchRepository の Drizzle 実装と executor ファクトリ
  - `lib/db/research-repository.ts` で `makeResearchRepo(executor: DbClient | Tx): ResearchRepository` を実装
  - `dbResearchRepo = makeResearchRepo(db)` を export
  - `list()`: `created_at` 降順ソート(全件)
  - `get(id)`: `where(eq(research.id, id)).limit(1)` で 1 件取得、未存在で `null`
  - `getByStoreId(storeId)`: `where(eq(research.store_id, storeId)).limit(1)` で 1 件取得(1:1 セマンティクス)
  - `create(input)`: `generateId("res")` で発番、`today()` で `created_at`/`updated_at`
  - `update(id, patch)`: 既存値とマージし `updated_at` を更新、未存在 ID で `null` 返却
  - `delete(id)`: `.returning({ id })` で削除有無判定し boolean 返却
  - `import "server-only"` 必須
  - `lib/db/deal-repository.ts` のパターンを忠実に踏襲
  - 観測可能な完了状態: 6 メソッドすべてが `pnpm typecheck` でエラーなく型が通り、`ResearchRepository` interface を完全に満たす(構造的型付けで TS が検証)
  - _Requirements: 1.1, 1.4, 2.1, 2.2, 2.3, 2.4, 2.5, 9.5, 10.1, 10.2_
  - _Boundary: lib/db/research-repository.ts_

- [x] 2.2 (P) HandoffRepository の Drizzle 実装と executor ファクトリ
  - `lib/db/handoff-repository.ts` で `makeHandoffRepo(executor: DbClient | Tx): HandoffRepository` を実装
  - `dbHandoffRepo = makeHandoffRepo(db)` を export
  - `list(storeId?)`: `created_at` 降順ソート、`storeId` 指定時のみ `where(eq(handoffs.store_id, storeId))` を追加
  - `get(id)` / `getByDealId(dealId)`: `where(eq).limit(1)`
  - `create / update / delete`: ResearchRepository と同等の規約
  - `payment_confirmed` の `null` ラウンドトリップ(空文字 `""` は変換せず Action 層に委ねる)
  - `import "server-only"` 必須
  - 観測可能な完了状態: 6 メソッドすべてが `pnpm typecheck` で型が通り、`payment_confirmed: null` を INSERT/UPDATE して `null` で読み返せる(コードレベル検証、実 DB 検証は Phase 7 で行う)
  - _Requirements: 1.1, 1.4, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 9.5, 10.1, 10.2, 10.3_
  - _Boundary: lib/db/handoff-repository.ts_

- [x] 2.3 lib/db バレルに research/handoff の re-export を追加
  - `lib/db/index.ts` に `export { makeResearchRepo, dbResearchRepo } from "./research-repository";` を追記
  - 同様に `makeHandoffRepo` / `dbHandoffRepo` を追記
  - 既存の `db` / `sql` / `DbClient` / `Tx` / `makeDealRepo` / `dbDealRepo` / `makeStoreRepo` / `dbStoreRepo` の re-export は無修正
  - 観測可能な完了状態: `await import("@/lib/db")` で 12 シンボル(既存 8 + 新規 4)すべてが解決する
  - _Depends: 2.1, 2.2_
  - _Requirements: 9.4_
  - _Boundary: lib/db/index.ts_

---

## Phase 3: Foundation — Composition Root の TxRepos 拡張

- [ ] 3. repos の TxRepos と DB ブランチを 4 entity 化

- [ ] 3.1 TxRepos / DB ブランチ / Mock 擬似 tx を 4 entity に拡張
  - `lib/repositories/index.ts` の `TxRepos` interface に `research: ResearchRepository` と `handoff: HandoffRepository` を追加
  - DB 経路 `buildRepos`: `research: dbResearchRepo`、`handoff: dbHandoffRepo` を bind し、コメント「research / handoff は別 Issue で DB 化される予定。現状は mock のまま」を削除
  - DB 経路 `transaction`: `db.transaction(tx => fn({ deal: makeDealRepo(tx), store: makeStoreRepo(tx), research: makeResearchRepo(tx), handoff: makeHandoffRepo(tx) }))` で 4 entity factory を渡す
  - Mock 経路 `transaction`: 擬似 tx callback に `{ deal: mockDealRepo, store: mockStoreRepo, research: mockResearchRepo, handoff: mockHandoffRepo }` を渡す
  - top-level await / `Object.freeze` / 動的 import 構造は無修正
  - 動的 import パスは静的に解析可能なリテラル(`@/lib/db`)を維持
  - 観測可能な完了状態: `repos.transaction(async ({ research }) => { ... })` および `repos.transaction(async ({ handoff }) => { ... })` が DB / Mock 両モードで型が通り、既存 `repos.transaction(async ({ deal, store }) => { ... })` 利用箇所(`createDealAction` など)は無修正で `pnpm typecheck` を通過する
  - _Requirements: 4.4, 4.5, 6.1, 6.2, 6.3, 6.4, 6.5, 9.4, 11.1, 11.2, 11.3_
  - _Boundary: lib/repositories/index.ts_

---

## Phase 4: Core — Server Action のトランザクション化

- [ ] 4. saveResearch / createHandoff / completeHandoff を repos.transaction 経由に

- [ ] 4.1 (P) saveResearchAction を repos.transaction 化
  - `lib/actions/research-actions.ts:saveResearchAction` の `repos.research.create or update` と `repos.store.update({stage, channel})` を `repos.transaction(async ({ research, store: storeTx }) => { ... })` で 1 単位化
  - tx 内で `research.getByStoreId(storeId)` → 既存有無で `update(existing.id, input)` or `create(input)` 分岐
  - tx 内で `storeTx.update(storeId, { stage: store.stage === "調査待ち" ? "調査完了" : store.stage, channel: input.channel })` を実行
  - tx 内で例外発生時はロールバックされ、`revalidateTag` 群を呼ばない(try/catch を tx 外側に置く)
  - tx 成功後にのみ `revalidateTag` 群(`research` / `researchByStore(storeId)` / `stores` / `store(storeId)` / `stats` / `actionQueue` / `pipeline`)を呼ぶ
  - 既存シグネチャ・戻り値型・FormData ハンドリング・`buildResearchInput` ヘルパは無修正
  - `saveResearchAndContinue` は `saveResearchAction` 呼び出し → redirect 構造を維持(無修正)
  - `lib/db/*` の直接 import は **行わない**(`repos` 越しのみ)
  - 観測可能な完了状態: research 保存中に store 更新を意図的に失敗させたシナリオ(stage 列挙外の値などで強制エラー)で research 行も永続化されない、成功時は research と store の両方が同一トランザクションで commit される。`pnpm typecheck` 通過。
  - _Requirements: 4.1, 4.2, 4.4, 4.5, 9.1, 9.4_
  - _Boundary: lib/actions/research-actions.ts_

- [ ] 4.2 (P) createHandoffAction と completeHandoffAction を repos.transaction 化
  - `lib/actions/handoff-actions.ts:createHandoffAction` の `repos.handoff.create(input)` と `repos.store.update(deal.store_id, { stage: "引き継ぎ待ち" })` を `repos.transaction(async ({ handoff, store }) => { ... })` で 1 単位化
  - `completeHandoffAction` の `repos.handoff.update(handoffId, { status: "完了" })` と `repos.store.update(current.store_id, { stage: "引き継ぎ完了" })` を同様に 1 tx に統合
  - tx 内で例外発生時はロールバックされ、`invalidate(...)` ヘルパを呼ばない(try/catch を tx 外側に置く)
  - tx 成功後にのみ `invalidate(handoffId, storeId)` ヘルパを呼ぶ
  - `updateHandoffAction` は単独 `repos.handoff.update` のため tx 不要(無修正)
  - `deleteHandoffAction` は単独 `repos.handoff.delete` + redirect のため tx 不要(無修正)
  - 既存シグネチャ・戻り値型・`buildInput` / `invalidate` ヘルパは無修正
  - `lib/db/*` の直接 import は **行わない**
  - 観測可能な完了状態: 引き継ぎ作成中に store 更新を失敗させたシナリオで handoff 行も永続化されない、`completeHandoffAction` で同様の不可分性が確認できる。`pnpm typecheck` 通過。
  - _Requirements: 4.3, 4.4, 4.5, 9.1, 9.4_
  - _Boundary: lib/actions/handoff-actions.ts_

---

## Phase 5: Integration — データ移送経路の DB 統合

- [ ] 5. data-actions / export route / seed の 4 entity 統合

- [ ] 5.1 (P) data-actions.ts の Mock パススルー削除と DB tx 4 entity 統合
  - `resetMockResearchAndHandoffOnly` / `clearMockResearchAndHandoffOnly` 関数を削除
  - `resetToSeedAction` (DB ブランチ): `db.transaction` 内で TRUNCATE 順序を `handoffs → research → deals → stores`(子→親、FK 整合)に拡張、INSERT 順序を `stores → deals → research → handoffs`(親→子)で全 4 entity を upsert
  - `clearAllAction` (DB ブランチ): 同 TRUNCATE 順序で 4 entity 全件削除
  - `importJsonAction` (DB ブランチ): JSON の 4 entity 全てを `db.transaction` 内で upsert(親→子順、`onConflictDoUpdate`)、`restoreMockDb` の Research/Handoff 引数渡しを DB モードでは省略
  - `getSnapshotForExportAction` (DB ブランチ): `Promise.all` を 4 entity に拡張(`repos.deal.list / store.list / research.list / handoff.list`)、`mockSnapshot` の Research/Handoff 抽出を削除
  - Mock モードのブランチは無修正(Req 8.6)
  - 既存シグネチャ・戻り値型は無修正
  - **Documented exception 維持**: `lib/db/client.ts` / `lib/db/schema.ts` の動的 import 戦略を継続(Mock モードで `DATABASE_URL` 未設定でも安全、`#1` から継承)
  - `mockDb` / `SEED_RESEARCH` / `SEED_HANDOFFS` の import は Mock モード専用処理用にのみ残す
  - 観測可能な完了状態: DB モードで Reset / Clear / Import / Export を実行し Mock 側 Research/Handoff Map が変化しない(=DB モードでは Mock 経由しない)、`pnpm typecheck` 通過
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_
  - _Boundary: lib/actions/data-actions.ts_

- [ ] 5.2 (P) Export route の DB 経路を 4 entity 統一
  - `app/api/export/route.ts` の DB モード分岐を `Promise.all([repos.deal.list(), repos.store.list(), repos.research.list(), repos.handoff.list()])` に統一
  - `mockSnapshot` 変数の参照を Mock モード分岐のみに限定し、DB モードでの `mock.research` / `mock.handoffs` 参照を削除
  - 既存の Cache Components 関連コメント(Node.js runtime 強制を委ねる旨)は維持
  - レスポンスヘッダ・Content-Disposition・ファイル名フォーマット・Cache-Control は無修正
  - 観測可能な完了状態: `GET /api/export` のレスポンス JSON 形状が両モードで同一、4 entity 全てが DB 経由で並列取得され waterfall を含まない、`pnpm typecheck` 通過
  - _Requirements: 8.1, 8.4_
  - _Boundary: app/api/export/route.ts_

- [ ] 5.3 (P) seed.ts に SEED_RESEARCH / SEED_HANDOFFS の upsert を追加
  - `scripts/seed.ts` で `lib/mock/seed` から `SEED_RESEARCH` / `SEED_HANDOFFS` を import 追加(既存 `SEED_STORES` / `SEED_DEALS` import に並ぶ形)
  - `lib/db/schema` から `research` / `handoffs` を import 追加
  - `db.transaction` 内 upsert 順序を `stores → deals → research → handoffs`(FK 整合)に拡張
  - 各 entity に対して `INSERT … ON CONFLICT (id) DO UPDATE SET …` の upsert ループを追加
  - 件数 `console.log` を 4 entity に拡張(`Seeded ${SEED_STORES.length} stores, ${SEED_DEALS.length} deals, ${SEED_RESEARCH.length} research, ${SEED_HANDOFFS.length} handoffs.`)
  - USE_MOCK_DB ガード(`process.exit(0)`)は既存維持
  - `sql.end()` での接続クリーンアップは既存維持
  - 観測可能な完了状態: 実 DB に対し `pnpm seed` を 2 連続実行しても最終状態が同一、件数が `SEED_RESEARCH.length` / `SEED_HANDOFFS.length` と一致(実 DB 検証は Phase 6 / 7 で実施可能)。`pnpm typecheck` 通過
  - _Depends: 1.2_
  - _Requirements: 7.1, 7.2, 7.3, 7.4_
  - _Boundary: scripts/seed.ts_

---

## Phase 6: Migration 適用と README 更新

- [ ] 6. Supabase 反映と README 更新

- [ ] 6.1 Supabase へ research/handoffs マイグレーションを適用
  - Supabase プロジェクトの `DATABASE_URL` が `.env.local` に設定済であることを確認
  - `pnpm drizzle-kit migrate` を実行し、Supabase 側に `research` / `handoffs` テーブルおよび 3 つの FK を作成
  - 既存の `stores` / `deals` テーブルは無修正で残ることを Supabase ダッシュボードで確認
  - 必要に応じて `research(store_id)` / `handoffs(store_id)` / `handoffs(deal_id)` のインデックスが drizzle-kit により自動生成されるか確認(無い場合は本タスク内で明示的に追加 SQL を実行)
  - 観測可能な完了状態: Supabase ダッシュボードで `research` / `handoffs` テーブルおよび 3 FK 制約が確認でき、空テーブル状態で `pnpm seed` を実行すると 4 entity の SEED が投入される
  - _Depends: 1.2_
  - _Requirements: 1.1, 1.2_
  - _Boundary: Supabase project_

- [ ] 6.2 (P) README の Supabase セットアップ節を 4 テーブル化
  - 既存「DB に置き換える際の手順」/「Supabase + Drizzle DB セットアップ」節の対象テーブル記述を `stores / deals / research / handoffs` に更新
  - `pnpm seed` の出力件数の例を 4 entity に更新
  - `pnpm drizzle-kit migrate` で `0000_*.sql` および `0001_*.sql` の両方が適用される旨を明記
  - 既存の `USE_MOCK_DB=true` 切替手順、`DATABASE_POOL_MAX` ガイドは無修正
  - 観測可能な完了状態: 新しい開発者が README だけで 4 テーブル構成の Supabase セットアップを完了できる、修正された節がコードレビューで確認できる
  - _Requirements: 12.1_
  - _Boundary: README.md_

---

## Phase 7: Validation — 静的検証・テスト・E2E

- [ ] 7. 全体検証

- [ ] 7.1 静的検証コマンドを通過
  - `pnpm typecheck` がエラーなく完了
  - `pnpm lint` がエラーなく完了(`any` 不使用、未使用 import なし)
  - `pnpm build` がエラーなく完了
  - 既存 Server Action(`saveResearchAction` / `saveResearchAndContinue` / `createHandoffAction` / `updateHandoffAction` / `completeHandoffAction` / `deleteHandoffAction`)シグネチャ無修正、既存 `'use cache'` クエリ(`getResearchByStore` / `getResearchQueue` / `listHandoffsCached` / `getHandoffCached`)シグネチャ無修正、`CACHE_TAGS.research` 系・`CACHE_TAGS.handoffs` 系 タグキー無修正を grep で確認
  - Repository interface(`ResearchRepository` / `HandoffRepository`)が無修正であることを確認
  - 観測可能な完了状態: 3 コマンドすべてが exit code 0、修正したコンポーネント以外の差分が無いことを `git diff --stat` で確認
  - _Depends: 4.1, 4.2, 5.1, 5.2, 5.3_
  - _Requirements: 9.1, 9.2, 9.3, 9.5, 12.1_

- [ ] 7.2 (P) makeResearchRepo / makeHandoffRepo の Vitest 単体テスト
  - `lib/db/__tests__/research-repository.test.ts` および `lib/db/__tests__/handoff-repository.test.ts` を新設
  - mock executor(`vi.fn()` でチェイン可能なオブジェクト)を渡して各メソッドが期待どおりの drizzle クエリビルダー呼び出しを行うか確認
  - `getByStoreId` が `limit(1)` を含むことを確認
  - `payment_confirmed: null` の INSERT/UPDATE/SELECT ラウンドトリップを確認(空文字 `""` は変換せず往復)
  - `vitest.config.ts` への追加変更不要(既存 `server-only` empty alias で十分)
  - 観測可能な完了状態: `pnpm test` で新規テストファイル 2 つが pass する(P0 リグレッション網に追加)
  - _Depends: 2.1, 2.2_
  - _Requirements: 12.1_
  - _Boundary: lib/db/__tests__/_

- [ ] 7.3 (P) DB モードでの E2E 検証
  - `DATABASE_URL` を設定して `pnpm dev` で起動、`USE_MOCK_DB` は未設定
  - `/research/{storeId}` で調査を保存 → store.stage="調査完了"、channel が入力値に同期されることを確認
  - 受注済み deal から `/handoffs/new?dealId={dealId}` で引き継ぎを作成 → store.stage="引き継ぎ待ち" を確認
  - `/handoffs/{handoffId}` で完了 → store.stage="引き継ぎ完了" を確認
  - プロセスを Ctrl+C で停止 → `pnpm dev` で再起動
  - `/research/{storeId}` および `/handoffs` で先ほど作成・更新したデータが残存していることを確認
  - `/dashboard` / `/kpi` / `/pipeline` で Research / Handoff の集計反映を確認
  - 観測可能な完了状態: 7 ステップすべてが成功、Supabase ダッシュボードで 4 テーブル(`stores` / `deals` / `research` / `handoffs`)にデータが保持されている
  - _Depends: 7.1, 6.1_
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.1, 4.2, 4.3, 5.1, 5.2, 5.3, 12.2_

- [ ] 7.4 (P) Mock モードでの E2E 検証
  - `USE_MOCK_DB=true pnpm dev` で起動(`DATABASE_URL` を未設定にしても起動成功すること)
  - 同等の研究保存・引き継ぎ作成・完了操作が動作することを確認
  - 観測可能な完了状態: `DATABASE_URL` 未設定でも全 UI 機能が動作、Mock の Research/Handoff 操作が `#1` の振る舞いから劣化していない
  - _Depends: 7.1_
  - _Requirements: 6.1, 6.5, 7.1, 12.3_

- [ ] 7.5 (P) Settings の Export / Import / Reset E2E
  - DB モードで Settings 画面から Export → ダウンロード JSON に 4 entity 全データ(`stores` / `deals` / `research` / `handoffs`)が含まれることを確認
  - 同 JSON を Import → 4 entity が DB に upsert されることを Supabase ダッシュボードで件数確認
  - Reset → 4 entity が SEED 初期状態に戻ることを確認
  - DB モードで Mock 経由の研究/引き継ぎ操作が一切発生しない(Mock の Research/Handoff Map が初期状態のまま)ことを確認
  - Mock モードで同操作を実行し、4 entity 全てが Mock 越しに従来通り動作することを確認
  - 観測可能な完了状態: 4 entity の Export/Import/Reset が DB モードでは DB 経路のみ、Mock モードでは Mock 経路のみで動作し、混在処理(`#1` の妥協措置)が排除されている
  - _Depends: 7.1, 6.1_
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 12.4_

---

## Implementation Notes

- **1.2**: drizzle-kit の自動命名は `0001_<adjective>_<noun>.sql` 形式(`#1` の `0000_living_darwin.sql` と同パターン)。Issue #2 本文の `0001_research_handoff.sql` 想定とは異なる可能性があるが、命名強制はせず drizzle-kit に委ねる(設計合意済)。**実際の生成結果**: 別セッション(#13)が `0001_add_operator_and_ai_analysis.sql` を先に取得していたため、本 spec の migration は **`0002_simple_sage.sql`** として生成された。drizzle-kit が `0002` を自動採番する挙動が想定通りであることを確認。Phase 6 の Supabase 反映は `pnpm drizzle-kit migrate` で `0001` + `0002` の両方が順次 apply される。
- **2.1 / 2.2**: 1:1 enforcement の race condition は **アプリ層担保** とし、DB-level UNIQUE 制約は採用しない(`research.store_id`)。並行保存で重複 research 行が稀に生じた場合は手動 cleanup で対応。本リスクは `requirements.md` の 1:1 セマンティクス(`getByStoreId` `limit(1)`)で運用上吸収。
- **3.1**: `TxRepos` の **追加** は構造的型付けによる非破壊変更。`#1` の `createDealAction` / `updateDealAction` の `repos.transaction(async ({ deal, store }) => ...)` は分割代入で `research` / `handoff` を参照しないため、本 spec の変更で **コンパイルエラー / 振る舞い変更ともに発生しない**。
- **5.1**: Documented exception(`lib/db/client.ts` / `lib/db/schema.ts` の直接 import)は `#1` から継続維持。本 spec で他ファイルへの追加は禁止。Mock モードで `DATABASE_URL` 未設定でも安全に動作させるため、import 文字列は静的に解析可能なリテラル(`@/lib/db/client` / `@/lib/db/schema`)を維持。
- **5.3**: 既存 `scripts/seed.ts` は `pnpm seed`(`NODE_OPTIONS='--conditions=react-server' tsx scripts/seed.ts`)で実行する `package.json` 設定が `#1` で導入済。本 spec で seed コマンドの変更は不要。
- **7.2**: 既存 `vitest.config.ts` は `server-only` を `empty.js` に alias し `react-server` condition を有効化済(`#10` Phase A 完了時)。新規 DB Repository テストは同設定で動作するが、実 DB 接続は不要(mock executor で SQL 発行を検証)。実 DB を使う Integration テストは Phase 7.3〜7.5 の手動 E2E に統合。
- **7.3 / 7.5**: `requirements.md §12.2 / §12.4` の手動 E2E 手順を踏襲。Supabase ダッシュボードでの件数確認をエビデンスとして残す。

---

## カバレッジ確認(自己照合)

- **Requirements 全 47 サブ ID**:
  - Req 1 (1.1〜1.4): T1.1 / T2.1 / T2.2 / T7.3
  - Req 2 (2.1〜2.5): T1.1 / T2.1 / T4.1 / T7.3
  - Req 3 (3.1〜3.8): T1.1 / T2.2 / T4.2 / T7.3
  - Req 4 (4.1〜4.5): T3.1 / T4.1 / T4.2 / T7.3
  - Req 5 (5.1〜5.3): T4.1 / T4.2 / T7.3
  - Req 6 (6.1〜6.5): T3.1 / T7.4
  - Req 7 (7.1〜7.4): T5.3 / T7.4
  - Req 8 (8.1〜8.6): T5.1 / T5.2 / T7.5
  - Req 9 (9.1〜9.5): T2.3 / T3.1 / T4.1 / T4.2 / T7.1
  - Req 10 (10.1〜10.5): T1.1 / T2.1 / T2.2 / T7.2
  - Req 11 (11.1〜11.3): T3.1 / T4.1 / T4.2
  - Req 12 (12.1〜12.4): T6.2 / T7.1 / T7.2 / T7.3 / T7.4 / T7.5

- **Components(design.md §「Components and Interfaces」の 10 件)**:
  - `lib/db/schema.ts`(拡張) → T1.1
  - `lib/db/research-repository.ts`(新規) → T2.1
  - `lib/db/handoff-repository.ts`(新規) → T2.2
  - `lib/db/index.ts`(拡張) → T2.3
  - `lib/repositories/index.ts`(修正) → T3.1
  - `lib/actions/research-actions.ts`(修正) → T4.1
  - `lib/actions/handoff-actions.ts`(修正) → T4.2
  - `lib/actions/data-actions.ts`(修正) → T5.1
  - `app/api/export/route.ts`(修正) → T5.2
  - `scripts/seed.ts`(修正) → T5.3

- **Tooling / Migration / Docs**:
  - `drizzle/0001_*.sql` → T1.2
  - Supabase migrate apply → T6.1
  - README → T6.2

- **Validation**: T7.1(静的)/ T7.2(Unit)/ T7.3(DB E2E)/ T7.4(Mock E2E)/ T7.5(Settings E2E)
