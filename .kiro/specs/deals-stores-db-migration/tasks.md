# Implementation Plan — deals-stores-db-migration

> 本タスクリストは `requirements.md` (11 Requirements) と `design.md` のコンポーネント・契約・整合性決定を、実装可能な単位 (1〜3 時間目安) に分解したものである。`(P)` マーク付きのタスクは並行実行可能、`_Depends:_` は順序由来でない非自明な依存を示す。

---

## Phase 1: Foundation — 依存・環境設定

- [ ] 1. 依存パッケージと env 基盤の整備

- [x] 1.1 Drizzle / postgres.js / drizzle-kit / tsx を依存追加
  - `pnpm add drizzle-orm postgres` で runtime 依存を追加
  - `pnpm add -D drizzle-kit tsx` で devDep を追加
  - lockfile を更新し `pnpm typecheck` がエラーなく完了
  - 観測可能な完了状態: `package.json` に 4 パッケージが記録され、`node_modules/drizzle-orm` と `node_modules/postgres` が存在する
  - _Requirements: 1.1, 9.1_

- [x] 1.2 (P) 環境変数バリデーションヘルパを実装
  - `lib/env.ts` に `assertEnv(key)` と `readEnv(key, fallback?)` を実装
  - 必須キー欠落時は `Error("Missing required env: <key>")` を throw
  - 値の trim と空文字判定を含み、エラーメッセージにキー名のみを含める(値はマスク)
  - 観測可能な完了状態: 未設定キーで呼ぶと throw、設定済みキーでは値が返る単体動作確認
  - _Requirements: 6.1, 6.3_
  - _Boundary: lib/env.ts_

- [ ] 1.3 (P) `.env.example` に必要キーを記載
  - `DATABASE_URL`、`USE_MOCK_DB`、`DATABASE_POOL_MAX` を記載
  - 各キーにコメントで Self-host (`max=10`) / Vercel (`max=1`) の使い分けを併記
  - 観測可能な完了状態: ファイルが存在し、開発者がコピーして `.env.local` を作成できる雛形になっている
  - _Requirements: 6.3_
  - _Boundary: .env.example_

- [ ] 1.4 (P) Drizzle Kit の設定ファイルを作成
  - `drizzle.config.ts` で schema パスを `lib/db/schema.ts`、出力ディレクトリを `drizzle/` に設定
  - `dbCredentials.url` を `DATABASE_URL` 環境変数から取得
  - 観測可能な完了状態: `pnpm drizzle-kit --help` 系の検証コマンドで設定が認識される、`pnpm drizzle-kit generate` の dry-run が走る
  - _Requirements: 1.1_
  - _Boundary: drizzle.config.ts_

---

## Phase 2: Foundation — スキーマと DB クライアント

- [ ] 2. テーブルスキーマ・クライアント singleton・初期マイグレーション

- [ ] 2.1 stores と deals のテーブルスキーマを定義
  - `lib/db/schema.ts` で `pgTable("stores", {...})` と `pgTable("deals", {...})` を定義
  - `types/store.ts` `types/deal.ts` の全フィールドと 1:1 対応(text PK、`order_amount` のみ nullable、その他 NOT NULL)
  - `deals.store_id` に `references(() => stores.id)` で外部キー制約
  - `created_at` / `updated_at` は `text` (`YYYY-MM-DD` 文字列のまま運用)
  - 列挙型(`Priority` / `StageId` / `Channel` / `DealStatus`)は Postgres ENUM 化せず `text` で保持
  - 観測可能な完了状態: スキーマファイルが import できるテストモジュールから `stores.id`, `deals.store_id` の型が正しく推論される
  - _Requirements: 1.1, 10.1, 10.2, 10.3_
  - _Boundary: lib/db/schema.ts_

- [ ] 2.2 DB クライアント singleton と起動時 health check を実装
  - `lib/db/client.ts` 冒頭に `import "server-only"`
  - `Symbol.for("__FW_SALES_DB__")` を `globalThis` に紐付け、HMR 跨ぎで `postgres()` と `drizzle()` を 1 つだけ生成
  - postgres オプション: `prepare: false`(Supabase Transaction Pooler 互換)、`max: Number(env.DATABASE_POOL_MAX ?? 10)`
  - 末尾で fire-and-forget の `void sql\`select 1\`.catch(err => { console.error(...); process.exit(1); })` を発行
  - `db` / `sql` / 型エイリアス `DbClient` / `Tx` を export
  - 観測可能な完了状態: 接続失敗時に process が `exit(1)` で停止、成功時は `db` import で同一インスタンスが返る
  - _Requirements: 1.2, 6.2, 6.4_
  - _Boundary: lib/db/client.ts_

- [ ] 2.3 初期マイグレーション SQL を生成しコミット
  - `pnpm drizzle-kit generate` で `drizzle/0000_init.sql` を生成
  - 生成 SQL に `CREATE TABLE stores (...)` と `CREATE TABLE deals (... FOREIGN KEY (store_id) REFERENCES stores(id))` が含まれること
  - `drizzle/meta/_journal.json` を含めて git に追加
  - 観測可能な完了状態: `drizzle/0000_init.sql` がリポジトリに存在し、SQL を Postgres で実行すると 2 テーブルが作成される
  - _Depends: 2.1, 1.4_
  - _Requirements: 1.1_
  - _Boundary: drizzle/_

---

## Phase 3: Core — Repository 実装

- [ ] 3. Drizzle ベースの DealRepository / StoreRepository

- [ ] 3.1 (P) DealRepository の Drizzle 実装と executor ファクトリ
  - `lib/db/deal-repository.ts` で `makeDealRepo(executor: DbClient | Tx): DealRepository` を実装
  - `dbDealRepo = makeDealRepo(db)` を export
  - `list(storeId?)`: `created_at` 降順ソート、`storeId` 指定時は WHERE 絞り込み
  - `create(input)`: `generateId("deal")` で発番、`today()` で `created_at`/`updated_at`、`order_amount` の null 受け渡し対応
  - `update(id, patch)`: 既存値とマージし `updated_at` を更新、未存在 ID で `null` 返却
  - `delete(id)`: 削除件数 > 0 で `true`、それ以外 `false`
  - 観測可能な完了状態: テスト用 executor を渡して 5 メソッドすべてが期待通り SQL を発行(または in-memory 模擬実行で意図する結果を返す)
  - _Requirements: 1.1, 1.4, 2.1, 2.2, 2.3, 2.4, 2.5, 9.1, 10.1, 10.2_
  - _Boundary: lib/db/deal-repository.ts_

- [ ] 3.2 (P) StoreRepository の Drizzle 実装と executor ファクトリ
  - `lib/db/store-repository.ts` で `makeStoreRepo(executor): StoreRepository` を実装
  - `dbStoreRepo = makeStoreRepo(db)` を export
  - `list(filter?)`: `StoreFilter` の `q` / `stage` / `channel` / `priority` をすべて WHERE 句にマップ。`q` は `name`/`city`/`prefecture`/`address`/`genre`/`memo` を連結した ILIKE 部分一致
  - `create` / `update` / `delete`: DealRepository と同等の規約
  - `created_at` 降順ソート
  - 観測可能な完了状態: `StoreFilter` の各フィールド単独および組合せで期待件数が返ることを単体検証
  - _Requirements: 1.1, 1.4, 9.1, 10.1, 10.2_
  - _Boundary: lib/db/store-repository.ts_

- [ ] 3.3 `lib/db/index.ts` で公開 API を集約
  - `lib/db/index.ts` で `db`、`sql`、`DbClient`、`Tx`、`makeDealRepo`、`dbDealRepo`、`makeStoreRepo`、`dbStoreRepo` を re-export
  - これにより上位レイヤは `import("@/lib/db")` だけで全シンボルを取得可能
  - 観測可能な完了状態: `await import("@/lib/db")` で 8 シンボルすべてが解決する
  - _Depends: 2.2, 3.1, 3.2_
  - _Requirements: 9.4_
  - _Boundary: lib/db/index.ts_

---

## Phase 4: Foundation — Composition Root

- [ ] 4. Repository 集約と `repos.transaction()` API の構築

- [ ] 4.1 `lib/repositories/index.ts` を Repos interface + 動的 import 化
  - `Repos` / `TxRepos` interface を定義し、`store` / `research` / `deal` / `handoff` / `transaction` の 5 フィールドを明示
  - `buildRepos()` を実装: `process.env.USE_MOCK_DB === "true"` で Mock 経路、それ以外で `await import("@/lib/db")` の動的 import で DB 経路を構築
  - DB 経路の `transaction` は `db.transaction(async tx => fn({ deal: makeDealRepo(tx), store: makeStoreRepo(tx) }))`、Mock 経路は擬似 tx (シリアル実行、rollback なし)
  - top-level `await buildRepos()` の結果を `Object.freeze` して export
  - Mock モード時に `lib/db/*` のトップレベル評価が走らないこと(`DATABASE_URL` 未設定でも起動する)
  - 観測可能な完了状態: `USE_MOCK_DB=true` で `DATABASE_URL` 未設定 → `pnpm dev` 起動成功、未設定 + DB モード → `assertEnv` で起動失敗
  - _Depends: 3.3_
  - _Requirements: 3.2, 3.3, 5.1, 5.2, 5.4, 9.4_
  - _Boundary: lib/repositories/index.ts_

---

## Phase 5: Core — Action 層のトランザクション化

- [ ] 5. Server Action を `repos.transaction()` 経由に書換

- [ ] 5.1 `createDealAction` / `updateDealAction` を `repos.transaction()` 化
  - `lib/actions/deal-actions.ts` から `lib/db/*` の直接 import を完全排除
  - `createDealAction`: 店舗存在確認 → `repos.transaction(async ({ deal, store }) => { ... })` の中で `deal.create(input)` と `store.update(storeId, { stage })` を実行
  - `updateDealAction`: 同様に tx 内で `deal.update(...)` + `store.update(...)` を不可分実行
  - tx 内で例外発生時はロールバックされ、`invalidateDealScopes` を呼ばない(try/catch を tx 外側に置く)
  - 既存シグネチャ・戻り値型・FormData ハンドリング・`STAGE_BY_DEAL_STATUS` マッピングは無修正
  - `deleteDealAction` は単独操作のため tx 不要、既存ロジックを維持
  - 観測可能な完了状態: 商談作成中に store 更新を意図的に失敗させたシナリオで Deal 行も永続化されない、成功時は Deal + Store の両方が同一トランザクションで commit される
  - _Depends: 4.1_
  - _Requirements: 3.1, 3.2, 3.3, 9.1, 9.4_
  - _Boundary: lib/actions/deal-actions.ts_

---

## Phase 6: Integration — データ移送経路の DB 対応

- [ ] 6. SEED スクリプト・データアクション・Export route の DB 経路対応

- [ ] 6.1 (P) SEED 投入スクリプトを実装
  - `scripts/seed.ts` を作成し `tsx scripts/seed.ts` で実行可能に
  - `process.env.USE_MOCK_DB === "true"` の場合は警告を出して exit (誤実行防止)
  - `lib/db/client.ts` から `db` を直接 import し、`SEED_STORES` を先に投入後 `SEED_DEALS` を投入(FK 整合確保)
  - `INSERT … ON CONFLICT (id) DO UPDATE SET …` で全カラムを upsert(ベキ等)
  - 投入完了後、stores / deals の件数を `console.log`
  - 観測可能な完了状態: `pnpm tsx scripts/seed.ts` を 2 連続実行しても最終状態が同一、件数が `SEED_STORES.length` / `SEED_DEALS.length` と一致
  - _Depends: 2.2, 2.3_
  - _Requirements: 7.1, 7.2, 7.3_
  - _Boundary: scripts/seed.ts_

- [ ] 6.2 (P) `data-actions.ts` を DB / Mock 二経路に対応
  - 冒頭に `isMockMode()` ヘルパを定義
  - `resetToSeedAction` (DB モード): `db.transaction` で `truncate deals; truncate stores;` 後に SEED を upsert + Mock 側 Research/Handoff を `resetMockDb` の該当部のみリセット
  - `clearAllAction` (DB モード): `db.transaction` で `truncate deals; truncate stores;` + Mock 側 Research/Handoff のみ `clearMockDb` 経由でクリア
  - `importJsonAction` (DB モード): JSON の `stores`/`deals` を upsert、`research`/`handoffs` は `restoreMockDb` 経由で Mock に復元
  - `getSnapshotForExportAction`: DB モード時は `Promise.all([repos.deal.list(), repos.store.list()])` + Mock からの Research/Handoff 部分を統合、Mock モード時は従来通り
  - 既存シグネチャ・戻り値型・キャッシュ失効ロジックは無修正
  - **Documented exception**: `data-actions.ts` は TRUNCATE / BULK UPSERT の DDL 操作を含むため、`lib/db/client.ts` および `lib/db/schema.ts` の **直接 import を許容**(Repository interface 越しでは表現困難)。`design.md` のコンポーネント Outbound 依存記載に準拠
  - 観測可能な完了状態: DB モードで Reset 実行 → Supabase の stores/deals が SEED 状態に戻り、Research/Handoff は Mock の SEED 状態を維持
  - _Depends: 4.1, 6.1_
  - _Requirements: 8.2, 8.3, 8.4, 8.5_
  - _Boundary: lib/actions/data-actions.ts_

- [ ] 6.3 (P) Export route に runtime 宣言と並列取得を追加
  - `app/api/export/route.ts` 冒頭に `export const runtime = "nodejs"` を明示宣言
  - DB モード時: `Promise.all([repos.deal.list(), repos.store.list()])` で並列取得し、Research/Handoff は `snapshotMockDb()` から該当部のみ抽出して結合
  - Mock モード時: 従来通り `snapshotMockDb()` を一括返却
  - レスポンスヘッダ・Content-Disposition・ファイル名フォーマットは無修正
  - 観測可能な完了状態: `GET /api/export` のレスポンス JSON 形状が両モードで同一、ダウンロードファイルが Import 機能で読み戻せる
  - _Depends: 4.1_
  - _Requirements: 8.1, 8.4, 8.5_
  - _Boundary: app/api/export/route.ts_

---

## Phase 7: Migration 適用とドキュメント

- [ ] 7. Supabase 反映と README 更新

- [ ] 7.1 Supabase へマイグレーションを適用
  - Supabase プロジェクトを準備し `DATABASE_URL` を `.env.local` に設定
  - `pnpm drizzle-kit migrate` を実行し、Supabase 側に `stores` / `deals` テーブルを作成
  - 必要に応じて `deals.store_id` / `deals.created_at` / `stores.created_at` のインデックスを SQL で追加
  - 観測可能な完了状態: Supabase ダッシュボードで `stores` / `deals` テーブルおよび FK 制約が確認できる
  - _Depends: 2.3_
  - _Requirements: 1.1, 1.2_
  - _Boundary: Supabase project_

- [ ] 7.2 (P) README に DB セットアップ手順を追記
  - Supabase プロジェクト作成・接続文字列取得手順
  - `.env.local` の設定例(`DATABASE_URL`、`USE_MOCK_DB`、`DATABASE_POOL_MAX`)
  - `pnpm drizzle-kit generate` / `migrate` のコマンド例
  - `pnpm tsx scripts/seed.ts` の実行例
  - `USE_MOCK_DB=true pnpm dev` で Mock モードに戻す手順
  - Self-host vs Vercel での `DATABASE_POOL_MAX` ガイド
  - 観測可能な完了状態: 新しい開発者が README だけで DB セットアップを完了できる手順が含まれる
  - _Requirements: 11.1_
  - _Boundary: README.md_

---

## Phase 8: Validation — 静的検証と E2E

- [ ] 8. 全体検証

- [ ] 8.1 静的検証コマンドを通過
  - `pnpm typecheck` がエラーなく完了
  - `pnpm lint` がエラーなく完了(`any` 不使用、未使用 import なし)
  - `pnpm build` がエラーなく完了
  - 既存 Server Action のシグネチャ無修正・既存 `'use cache'` クエリのシグネチャ無修正・`CACHE_TAGS` 無修正を grep で確認
  - 観測可能な完了状態: 3 コマンドすべてが exit code 0、修正したコンポーネント以外の差分が無い
  - _Depends: 5.1, 6.2, 6.3_
  - _Requirements: 9.1, 9.2, 9.3, 9.5, 11.1_

- [ ] 8.2 (P) DB モードでの E2E 検証
  - `DATABASE_URL` を設定して `pnpm dev` で起動、`USE_MOCK_DB` は未設定
  - `/stores/{storeId}` 画面で「商談を作成」→ 必須項目入力 →「受注」ステータスで保存
  - プロセスを Ctrl+C で停止 → `pnpm dev` で再起動
  - `/deals` を開き、先ほど作成した商談が残存していることを確認
  - `/stores/{storeId}` で `stage` が「受注」に同期されていることを確認
  - `/dashboard` / `/kpi` / `/pipeline` で受注金額・件数が集計に反映されていることを確認
  - 観測可能な完了状態: 5 ステップすべてが成功
  - _Depends: 8.1, 7.1_
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 4.1, 4.2, 4.3, 11.2_

- [ ] 8.3 (P) Mock モードでの E2E 検証
  - `USE_MOCK_DB=true pnpm dev` で起動(`DATABASE_URL` を未設定にしても起動成功すること)
  - 同等の商談 CRUD 操作が動作することを確認
  - Settings 画面から Reset / Import / Export を実行し、Mock 単独で従来通り動作することを確認
  - 観測可能な完了状態: `DATABASE_URL` 未設定でも全 UI 機能が動作、Reset 後に SEED データに戻る
  - _Depends: 8.1_
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 7.1, 11.3_

---

## カバレッジ確認(自己照合)

- **Requirements 全 33 AC**: Req 1.1〜11.3 まで上記タスクで網羅(Phase 8 の E2E が大半の振る舞いを再検証)
- **Components 全 10**:
  - `lib/env.ts` → 1.2
  - `lib/db/schema.ts` → 2.1
  - `lib/db/client.ts` → 2.2
  - `lib/db/deal-repository.ts` → 3.1
  - `lib/db/store-repository.ts` → 3.2
  - `lib/db/index.ts` → 3.3
  - `lib/repositories/index.ts` → 4.1
  - `lib/actions/deal-actions.ts` → 5.1
  - `lib/actions/data-actions.ts` → 6.2
  - `app/api/export/route.ts` → 6.3
- **Tooling/Migration/Docs**:
  - `drizzle.config.ts` → 1.4
  - `drizzle/` migrations → 2.3, 7.1
  - `scripts/seed.ts` → 6.1
  - `.env.example` → 1.3
  - `package.json` → 1.1
  - README → 7.2
- **Validation**: 8.1 (静的) / 8.2 (DB E2E) / 8.3 (Mock E2E)
