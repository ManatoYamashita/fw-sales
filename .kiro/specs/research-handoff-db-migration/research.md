# Gap Analysis — research-handoff-db-migration

> 本ドキュメントは要件 (`requirements.md`) と既存コードベースのギャップを評価し、設計フェーズへ持ち込むべき判断材料を整理する分析メモである。**最終決定は `design.md` で行う**。
>
> Issue #1 (`deals-stores-db-migration`) で確立された永続化基盤を **再利用** する前提で評価しており、新規アーキテクチャは導入しない。

---

## 1. Current State Investigation

### 1.1 ドメイン関連の既存資産

| 領域 | パス | 役割・特徴 |
|---|---|---|
| 型定義 | `types/research.ts` `types/handoff.ts` | `Research` (23 フィールド) / `Handoff` (16 フィールド)。`Handoff.payment_confirmed` のみ `string \| null` で nullable。`*Input` = `Omit<T, "id" \| "created_at" \| "updated_at">`、`*Patch` = `Partial<*Input>` の派生型運用 |
| Repository interface | `lib/repositories/research-repository.ts` `lib/repositories/handoff-repository.ts` | CRUD + ドメイン特化メソッド。`ResearchRepository.getByStoreId` (1:1)、`HandoffRepository.list(storeId?)` / `getByDealId` |
| Mock 実装 | `lib/mock/research.ts` `lib/mock/handoff.ts` | `mockDb.research` / `mockDb.handoffs` の `Map<string, T>` を操作。`generateId("res")` / `generateId("hand")` 由来の ID |
| Repository 集約 | `lib/repositories/index.ts:96-99` | DB モードでも `repos.research = mockResearchRepo` / `repos.handoff = mockHandoffRepo` を意図的に維持(コメント「別 Issue で DB 化される予定」)。`TxRepos` は `{ deal, store }` のみ |
| Server Actions | `lib/actions/research-actions.ts` `lib/actions/handoff-actions.ts` | `saveResearchAction` / `saveResearchAndContinue` / `createHandoffAction` / `updateHandoffAction` / `completeHandoffAction` / `deleteHandoffAction`。`updateStore({stage, channel})` を **独立 await で並走させており非トランザクション** |
| Cache タグ | `lib/cache.ts` | `research` / `researchByStore(storeId)` / `handoffs` / `handoff(id)` / `handoffsByStore(storeId)` を既に定義済 — 追加不要 |
| Queries (`'use cache'`) | `lib/queries/research.ts` `lib/queries/handoffs.ts` | `getResearchQueue` / `getResearchByStore` / `listHandoffsCached` / `getHandoffCached`。`repos.research.*` / `repos.handoff.*` 経由で透過 — 無修正でDB に切替可能 |
| SEED データ | `lib/mock/seed.ts:134` `:239` | `SEED_RESEARCH`(2件: store_001, store_002 紐付)/ `SEED_HANDOFFS`(1件: deal_002, store_005 紐付)既存 |
| Mock DB 初期化 | `lib/mock/db.ts:26-33` | `buildInitialDb()` で 4 エンティティの Map を SEED から構築済 |

### 1.2 #1 で完成した永続化基盤(本 Issue が再利用する資産)

| 資産 | パス | 本 Issue での再利用方法 |
|---|---|---|
| postgres + drizzle singleton | `lib/db/client.ts` | そのまま再利用。新規テーブル追加時に追加初期化は不要 |
| `makeXxxRepo(executor)` factory パターン | `lib/db/deal-repository.ts` `lib/db/store-repository.ts` | `makeResearchRepo(executor)` / `makeHandoffRepo(executor)` を **同一構造で実装** |
| Repository 集約 / 動的 import / `Object.freeze` | `lib/repositories/index.ts` | DB ブランチに `research: dbResearchRepo` / `handoff: dbHandoffRepo` を追加し、`TxRepos` を 4 エンティティに拡張 |
| `repos.transaction(fn)` API | `lib/repositories/index.ts:87-103` | `TxRepos` 拡張により Research/Handoff の書込みもアトミック化可能 |
| `lib/db/index.ts` バレル | `lib/db/index.ts` | re-export を追加するだけ |
| 起動時 health check | `lib/db/client.ts:62-67` | 既存の `select 1` で十分(新規テーブル個別の検証は不要) |
| マイグレーション運用 | `drizzle/0000_living_darwin.sql` | `pnpm drizzle-kit generate` で `0001_*.sql` を追加生成 → Supabase へ apply |
| SEED スクリプト | `scripts/seed.ts` | `SEED_RESEARCH` / `SEED_HANDOFFS` の upsert を追記、参照整合順序 (`stores → deals → research → handoffs`) を維持 |
| データ移送 (`data-actions.ts`) | `lib/actions/data-actions.ts` | DB モード時の `resetMockResearchAndHandoffOnly` / `clearMockResearchAndHandoffOnly` を **削除**(Req 8.4)。Reset/Clear/Import の DB トランザクションに research/handoffs を組み込む |
| Export route (`app/api/export/route.ts`) | `app/api/export/route.ts` | DB モード時の Mock 経路を排除し `Promise.all([deal, store, research, handoff].list())` に統一(Req 8.1, 8.4) |

### 1.3 既存コードの非トランザクション領域(本 Issue で transaction 化が必要)

`#1` は `createDealAction` / `updateDealAction` を `repos.transaction()` 化したが、以下の 3 つの Action は依然として `repos.X.create + repos.store.update` を **独立 await している**:

| Action | 並走している書込み | 必要なトランザクション化 |
|---|---|---|
| `saveResearchAction` (research-actions.ts:52-86) | `repos.research.create/update` + `repos.store.update({stage, channel})` | Req 4.1, 4.2, 4.4, 4.5 |
| `createHandoffAction` (handoff-actions.ts:54-73) | `repos.handoff.create` + `repos.store.update({stage: "引き継ぎ待ち"})` | Req 4.3, 4.4, 4.5 |
| `completeHandoffAction` (handoff-actions.ts:104-115) | `repos.handoff.update({status})` + `repos.store.update({stage: "引き継ぎ完了"})` | Req 4.4, 4.5 |

`updateHandoffAction` は単独 `repos.handoff.update` のみのため transaction 化不要。

### 1.4 アーキテクチャ・命名・依存方針(steering 一致)

- **一方向依存**: `app → lib/queries|actions → lib/repositories → lib/mock|lib/db`(維持)
- **`server-only` 隔離**: `lib/db/*` 全ファイルで先頭宣言(維持)
- **Cache Components 規約**: `'use cache'` + `cacheTag` + `revalidateTag(tag, "max")`(維持)
- **データソース単一窓口**: `lib/repositories/index.ts` の `repos`(維持)、`data-actions.ts` と `scripts/seed.ts` のみ documented exception(維持)
- **ID 形式**: `<entity>_<id>`(`res_001` / `hand_001`、`generateId("res")` / `generateId("hand")` 既存)
- **日付**: `text` の `YYYY-MM-DD`(維持)
- **列挙型**: text 保存 + Action 層で型ガード(維持)

---

## 2. Requirements Feasibility Analysis

### 2.1 要件 → 既存資産マッピング

| Req | 必要な技術要素 | 既存資産 | ギャップ種別 | 工数感 |
|---|---|---|---|---|
| **Req 1** Research/Handoff 永続化 | DB CRUD | Repository interface のみ(実装は Mock) | **Missing**: `lib/db/research-repository.ts` / `lib/db/handoff-repository.ts`、テーブル定義、マイグレーション | M (大半は #1 のテンプレート転写) |
| **Req 2** Research CRUD と表示 | 既存 UI のまま動作 | UI / Server Actions / Queries 完成済 | **Constraint**: シグネチャ無修正、`getByStoreId` 1:1 セマンティクス維持 | S |
| **Req 3** Handoff CRUD と表示 | 既存 UI のまま動作 | UI / Server Actions / Queries 完成済 | **Constraint**: `list(storeId?)` / `getByDealId` のセマンティクス維持 | S |
| **Req 4** 状態遷移整合性 | アトミック複数テーブル更新 | 現状 3 Action が **独立 await** | **Missing**: `repos.transaction()` 適用 + `TxRepos` 拡張 | S |
| **Req 5** 集計反映 | キャッシュ失効戦略 | `revalidateTag` 既存運用 | **OK**: タグキー追加なし、無修正で透過 | — |
| **Req 6** Mock フォールバック | env 分岐 | `lib/repositories/index.ts` 既存実装 | **Constraint**: 既存パターンに 2 エンティティ追加するのみ | S |
| **Req 7** SEED 再現性 | 投入スクリプト | `scripts/seed.ts` 既存(stores/deals のみ) | **Missing**: `SEED_RESEARCH` / `SEED_HANDOFFS` の upsert 追記、順序保証 | S |
| **Req 8** Export/Import/Reset 統一 | Mock パススルー削除 | `data-actions.ts` 内に `resetMockResearchAndHandoffOnly` / `clearMockResearchAndHandoffOnly` が残存 | **Missing/Cleanup**: DB モード経路へ統合、Mock 専用関数を削除 | S |
| **Req 9** API 後方互換 | シグネチャ無修正 | 既存 Action / Query / interface | **Constraint**: 6 Action + 4 Query + 2 interface を 1:1 で実装 | — |
| **Req 10** ID/日付/スキーマ互換 | text PK + nullable text | `generateId` / `today` 既存、`Handoff.payment_confirmed` nullable 仕様 | **Constraint**: Drizzle スキーマで `text("payment_confirmed")`(`.notNull()` を付けない)を確認 | S |
| **Req 11** transaction 拡張 | `TxRepos` 拡張 | `Repos.transaction` API 既存 | **Missing**: `TxRepos` の `research` / `handoff` フィールド追加、Mock 擬似 tx の 4 エンティティ対応 | S |
| **Req 12** 動作検証 | 標準コマンド + E2E | コマンド整備済 | **Unknown**: README に「research-handoff 移行版の手順」を追記する余地(任意) | S |

### 2.2 複雑性シグナル

- **CRUD 中心**: Research/Handoff いずれも単純 CRUD。Drizzle 標準操作で十分
- **トランザクション**: 3 Action(saveResearch / createHandoff / completeHandoff)で必要。既に確立した `repos.transaction()` パターンを適用するだけ
- **混在処理排除**: Issue #1 で許容した「Deal/Store は DB、Research/Handoff は Mock」の混在処理が、本 Issue で **完全に排除される**(Req 8.4)
- **データ整合の制約**: `handoffs.deal_id` → `deals.id` の FK 追加が新しい論点(`research.store_id` / `handoffs.store_id` は #1 の `deals.store_id` と同型)
- **1:1 制約**: Research は 1 店舗 1 調査。アプリ層で確立しているが、DB 側で `unique(store_id)` を入れるか議論の余地あり(後述 Open Questions)

### 2.3 Research Needed (design 段階で深掘りすべき項目)

1. **`Handoff.payment_confirmed` の nullable 取扱い**: Drizzle で `text("payment_confirmed")`(`.notNull()` を付けない)で TS 側の `string \| null` と整合するか。`deals.order_amount`(integer nullable)の前例を踏襲して問題ない見込みだが、テキスト nullable のラウンドトリップ(空文字 vs NULL)の挙動を一度確認
2. **Research の 1:1 enforcement**: `unique("store_id")` 制約を DB 側に入れるか
   - **Pro**: `getByStoreId` のセマンティクスを DB レベルで保証、データ破損防止
   - **Con**: 既存 Mock は制約を持たず暗黙運用、追加すると import 時のエラー伝播設計が必要
3. **FK の onDelete ポリシー**: `research.store_id` / `handoffs.{store_id, deal_id}` で `onDelete: 'restrict'`(default)/ `'cascade'` / `'set null'` のいずれか
   - **Pro 既定 (no cascade)**: 親削除時に子が残っていれば失敗 = データ保護(`#1` の `deals.store_id` も同方針)
   - **Con cascade 採用**: Reset/Clear で TRUNCATE 連鎖が楽になるが、トランザクション内で順序削除しているため不要
4. **Reset/Clear の TRUNCATE 順序**: 現在の DB Reset は `delete deals → delete stores`。新規追加で `delete handoffs → delete research → delete deals → delete stores` の順序が必要(`handoffs.deal_id` の FK 制約のため `deals` より前に `handoffs` を削除)
5. **`db.transaction` 内での非同期 import**: `lib/repositories/index.ts` で動的 import される `@/lib/db` バレルに `makeResearchRepo` / `makeHandoffRepo` を re-export するため、バレル更新が忘れていないか確認
6. **マイグレーション ID 命名**: `pnpm drizzle-kit generate` が自動採番する。Issue #2 本文で示唆された `0001_research_handoff.sql` は drizzle-kit の自動命名規約と異なる可能性あり(drizzle-kit は `0001_<adjective>_<noun>.sql` 形式)

---

## 3. Implementation Approach Options

### Option A: パターン忠実踏襲(Faithful Replay)— **推奨**

**ねらい**: `#1` で確立されたパターンを Research/Handoff にそのまま適用する。新規設計を一切持ち込まない。

**変更点**:
- 新規: `lib/db/research-repository.ts` / `lib/db/handoff-repository.ts`
- 修正: `lib/db/schema.ts`(2 テーブル追加 + FK)、`lib/db/index.ts`(re-export 追記)、`lib/repositories/index.ts`(DB ブランチに 2 entity 追加 + `TxRepos` 拡張)、`scripts/seed.ts`(SEED_RESEARCH/HANDOFFS upsert 追記)、`lib/actions/data-actions.ts`(Mock パススルー削除 + DB トランザクションに 4 entity 統合)、`app/api/export/route.ts`(全 entity を repos 経由で並列取得)、`lib/actions/research-actions.ts`(saveResearch を `repos.transaction` 化)、`lib/actions/handoff-actions.ts`(createHandoff / completeHandoff を `repos.transaction` 化)
- 新規 SQL: `drizzle/0001_*.sql`(drizzle-kit auto-generated)

**互換性**:
- ✅ Repository interface は無修正(`Req 9.5`)
- ✅ Server Action / Query シグネチャ無修正(`Req 9.1, 9.2`)
- ✅ `CACHE_TAGS` は既存定義を流用、追加なし(`Req 9.3`)
- ✅ `repos` 経由で透過(`Req 9.4`)、`TxRepos` の **追加** は internal extension で破壊的変更ではない
- ✅ 1:1 / 1:n のドメイン制約は `getByStoreId` / `list(storeId?)` の interface セマンティクスでそのまま保たれる

**Trade-offs**:
- ✅ 認知コストゼロ(`#1` を読めば本 Issue は機械的)
- ✅ レビュー容易、バグ温床が最小
- ✅ 将来の attachment / action_log テーブル化(別 Issue)も同パターンで反復可能
- ❌ 特になし

### Option B: 1:1 を DB 制約で強制(`unique("store_id")` on research)

**ねらい**: A に加えて、Research の 1:1 制約を DB レベルで保証。

**変更点**:
- A の内容に加え、`research` テーブルに `unique("store_id")` 制約を追加
- マイグレーションで明示的に UNIQUE インデックス生成

**Trade-offs**:
- ✅ Mock とは異なる「DB 側の追加保証」を提供。データ破損リスクをハード制約で排除
- ❌ 既存 Mock との挙動差(Mock では同一 store_id で 2 件作成可能、ただし `getByStoreId` は 1 件目しか返さない)
- ❌ Import 時に重複データ流入で UNIQUE 違反が発生する可能性 → 復旧設計が必要
- ❌ 「既存のドメイン慣習を破らない」原則と若干緊張(steering の `tech.md` 列挙: text 化など柔軟性重視の方針と整合性は微妙)

### Option C: 段階分離(Phase 化)

**ねらい**: テーブル追加と Repository 実装まではすぐ実施、Server Action のトランザクション化は次フェーズに分離。

**変更点**:
- A の DB / Repository / Repos 部分のみ実施
- `saveResearchAction` / `createHandoffAction` / `completeHandoffAction` の `repos.transaction()` 化は別タスク

**Trade-offs**:
- ✅ PR が小さくなる
- ❌ Req 4.4, 4.5(原子性)を満たさない、要件未充足
- ❌ #1 で `createDealAction` を transaction 化済の整合性が崩れる
- ❌ Recommendation: 採用しない

---

## 4. Effort & Risk

| 軸 | 評価 | 根拠 |
|---|---|---|
| **Effort** | **S–M (2.5–4 日)** | テーブル 2 / Repository 2 / `TxRepos` 拡張 / Action transaction 化 3 箇所 / SEED スクリプト追記 / data-actions / export route の Mock パススルー削除。すべてが `#1` のテンプレート再利用で機械的に書けるため、未経験技術ゼロ |
| **Risk** | **Low** | パターン・依存・接続戦略は #1 で立証済。新規論点は `payment_confirmed` nullable 文字列 / 1:1 制約有無 / FK onDelete ポリシーの 3 つに限定され、いずれも前例または design 判断で確定可能 |

**Risk 詳細**:
- 🟢 Drizzle スキーマ生成: `pgTable` 定義 → `drizzle-kit generate` を実績通り
- 🟢 接続・Pooler・HMR・健康チェックは無改修
- 🟢 Repository factory は #1 の machinery を 1:1 でコピー
- 🟡 `payment_confirmed` の空文字 / null 区別: `readString(formData) || null` で既に `null` 化されているが、DB 書込み時 / 読出し時の整合をテストで確認
- 🟡 `data-actions.ts` の TRUNCATE 順序を `handoffs → research → deals → stores` に拡張するパッチで漏れがあると FK 違反でエラー
- 🟢 `repos.transaction` の `TxRepos` 拡張は型エラーで早期検出可能(コンパイル時の保証)

---

## 5. Recommendations for Design Phase

### 5.1 Preferred Approach
**Option A(忠実踏襲)を推奨**。Issue #2 本文の宣言「同パターンの再適用のみで完了する」と完全一致。

### 5.2 Key Decisions to Lock in `design.md`

1. **Schema 定義**(`lib/db/schema.ts` に追記)
   - `research` table: 23 フィールド(主キー `text id` + `store_id text NOT NULL REFERENCES stores(id)` + 21 業務フィールド)
   - `handoffs` table: 16 フィールド(主キー `text id` + `store_id text NOT NULL REFERENCES stores(id)` + `deal_id text NOT NULL REFERENCES deals(id)` + `payment_confirmed text NULL`(NOT NULL を付けない)+ 12 業務フィールド)
   - 列挙型(`ResearchStatus` / `HandoffStatus` / `Channel`)は text のまま、Action 層で型ガード(`#1` と整合)
   - ID プレフィックス: `res_*` / `hand_*`、`generateId("res")` / `generateId("hand")` を継続

2. **`makeResearchRepo(executor)` / `makeHandoffRepo(executor)` ファクトリ**
   - `lib/db/research-repository.ts` / `lib/db/handoff-repository.ts` を新設
   - `executor: DbClient | Tx` を受け、`ResearchRepository` / `HandoffRepository` を返す
   - `dbResearchRepo = makeResearchRepo(db)` / `dbHandoffRepo = makeHandoffRepo(db)` を default export
   - `delete()` は `.returning({ id })` で削除有無判定(#1 の deal-repository と同パターン)
   - `list(storeId?)`(handoff): `storeId` 指定時のみ `where(eq(handoffs.store_id, storeId))` 追加 + `orderBy(desc(created_at))`
   - `getByStoreId`(research)/ `getByDealId`(handoff): `where(eq).limit(1)`

3. **`lib/db/index.ts` バレル拡張**
   - `export { makeResearchRepo, dbResearchRepo } from "./research-repository";`
   - `export { makeHandoffRepo, dbHandoffRepo } from "./handoff-repository";`

4. **`lib/repositories/index.ts` 修正**
   - `TxRepos` を `{ deal, store, research, handoff }` に拡張
   - DB ブランチ: `research: dbResearchRepo` / `handoff: dbHandoffRepo` を bind
   - `transaction` の DB 経路: `db.transaction(tx => fn({ deal: makeDealRepo(tx), store: makeStoreRepo(tx), research: makeResearchRepo(tx), handoff: makeHandoffRepo(tx) }))`
   - Mock 経路の `transaction` 擬似実装も 4 entity を渡す
   - 該当行のコメント「Research / Handoff は別 Issue で DB 化される予定」を削除

5. **Server Action transaction 化**(シグネチャ無修正)
   - `saveResearchAction`: `repos.transaction(async ({ research, store }) => { ... })` で `research.create/update` + `store.update({stage, channel})` を 1 単位
   - `createHandoffAction`: 同様に `handoff.create` + `store.update({stage: "引き継ぎ待ち"})` を 1 単位
   - `completeHandoffAction`: `handoff.update({status: "完了"})` + `store.update({stage: "引き継ぎ完了"})` を 1 単位
   - `revalidateTag` は tx 成功後に呼ぶ(失敗時はキャッシュ汚染しない)

6. **`scripts/seed.ts` 拡張**
   - `SEED_RESEARCH` / `SEED_HANDOFFS` を `lib/mock/seed` から import
   - `db.transaction` 内の upsert 順序: stores → deals → research → handoffs(FK 整合)
   - `console.log` 出力に件数を追加

7. **`lib/actions/data-actions.ts` Mock パススルー削除**
   - `resetMockResearchAndHandoffOnly` / `clearMockResearchAndHandoffOnly` 関数を削除
   - `resetToSeedAction` の DB ブランチ: TRUNCATE 順序を `handoffs → research → deals → stores`、INSERT 順序を逆転(stores → deals → research → handoffs)
   - `clearAllAction` の DB ブランチ: 同 TRUNCATE 順序で全件削除
   - `importJsonAction` の DB ブランチ: research / handoffs もトランザクション内で upsert(参照整合順序)
   - `restoreMockDb` の `research` / `handoffs` 引数渡しを DB モードでは省略

8. **`app/api/export/route.ts` 簡素化**
   - DB モードで `Promise.all([repos.deal.list(), repos.store.list(), repos.research.list(), repos.handoff.list()])` に統一
   - Mock モードは無修正(`snapshotMockDb()`)
   - `mockSnapshot` を DB ブランチで参照しないため import 不要

9. **マイグレーション**
   - `pnpm drizzle-kit generate` で `drizzle/0001_*.sql` を自動生成・コミット
   - Supabase 反映は `pnpm drizzle-kit migrate` または Supabase SQL Editor

### 5.3 Research Items を design へ持ち越し

- `payment_confirmed` の Drizzle text nullable のラウンドトリップ確認(空文字 vs NULL の境界)
- マイグレーション SQL の自動命名規約(`drizzle-kit generate` の挙動)
- README に research-handoff 移行版の手順を追記する範囲(任意)

### 5.4 Open Questions(ユーザー確認が望ましい)

1. **Research の 1:1 制約**: `research.store_id` に `unique` 制約を **付ける / 付けない** どちらにするか
   - 付けない案: Mock との挙動差を作らず、ドメイン慣習を維持
   - 付ける案: DB レベルでの 1:1 強制、データ破損防止
   - **推奨は「付けない」**: 既存 Mock 慣習との整合と、import 時のエラー設計回避を優先
2. **FK の onDelete**: `restrict`(default、`#1` 整合)で確定してよいか確認
   - **推奨は default**: `#1` の `deals.store_id` と同方針
3. **Server Action の transaction 化のスコープ**: 必須 3 箇所(save/create/complete)以外に追加する箇所があるか
   - **現状調査では 3 箇所で十分**(`updateHandoffAction` は単独更新のみで不要)
4. **README への手順追記**: `pnpm drizzle-kit generate && migrate` の手順を `#1` に追記する形で十分か、本 Issue 専用の節を立てるか
   - **推奨は #1 セクションを更新**(「research/handoffs を含む」を追記)

---

## 6. Output Checklist (Compliance)

- ✅ Requirement-to-Asset Map(12 件すべてに gap 種別タグ)
- ✅ Options A/B/C と trade-off
- ✅ Effort S–M / Risk Low と一行根拠
- ✅ Preferred approach (Option A) と key decisions
- ✅ Research Needed と Open Questions の分離

---

## 7. Design Synthesis Outcomes (`/kiro-spec-design` 時追記)

### 7.1 Generalization
- 12 件の Requirement はすべて「`#1 deals-stores-db-migration` で確立された永続化パターンを Research/Handoff に拡張する」という単一の上位課題のバリエーション。新規の汎化機能は導入せず、**既存の `makeXxxRepo(executor)` ファクトリ + `Repos.transaction` API を 4 entity に拡張する** ことで全要件を満たす
- `BaseRepository<T>` 抽象は導入しない。`#1` と同様に「エンティティが少数(4 件)で、CRUD が同型でも各 list/get の引数仕様が微妙に異なる(`getByStoreId` 1:1 / `list(storeId?)` / `getByDealId`)」ため、抽象化の利得より整合のための分岐コストが上回る

### 7.2 Build vs Adopt
| 領域 | 決定 | 根拠 |
|---|---|---|
| ORM | **Adopt 既存: `drizzle-orm@^0.45.2`** | `#1` で既に採用済。本 spec で追加ライブラリなし |
| DB ドライバ | **Adopt 既存: `postgres@^3.4.9`** | `#1` で確立した postgres.js + Transaction Pooler + `prepare: false` をそのまま継承 |
| マイグレーション CLI | **Adopt 既存: `drizzle-kit`(devDep)** | `pnpm drizzle-kit generate` で `0001_*.sql` を自動生成・コミット |
| TS スクリプト実行 | **Adopt 既存: `tsx`(devDep)** | `pnpm seed` (`scripts/seed.ts`) で SEED_RESEARCH/HANDOFFS 投入 |
| 1:1 制約強制 | **Build なし(DB UNIQUE 不採用)** | Mock 慣習との整合を優先。Action 層の `getByStoreId` 事前チェックで担保 |
| FK onDelete | **Adopt 既存: default(`restrict`)** | `#1` の `deals.store_id` と同方針、データ保護優先 |

本 spec で **新規依存追加は 0 件**。

### 7.3 Simplification
- **Repository 抽象に新メソッド追加なし**: `bulkUpsert` / `truncate` などは導入せず、`data-actions.ts` / `scripts/seed.ts` の Documented exception(`#1` で確立済)を継続適用
- **`data-actions.ts` のファイル分割なし**: env 分岐 + lazy import + `db.transaction` の 1 ファイル運用を維持(`#1` と整合)
- **`repos.transaction` API シグネチャ無修正**: `TxRepos` インタフェース内部に `research` / `handoff` を追加するのみ(構造的型付けで既存利用箇所は無修正で動作)
- **`research.store_id` の DB-level UNIQUE 不採用**: アプリ層の 1:1 セマンティクス(`getByStoreId().limit(1)` + Action 層 existing check)で十分
- **README は最小修正**: `#1` の Supabase セットアップ節を「research/handoffs を含む 4 テーブル」に拡張するのみ。新規節は立てない
- **Server Action transaction 化のスコープ**: 必要な 3 箇所(`saveResearchAction` / `createHandoffAction` / `completeHandoffAction`)に限定。`updateHandoffAction` / `deleteHandoffAction` は単独更新のため tx 不要

### 7.4 Boundary Synthesis
- 本 spec の責務は「`#1` で確立された永続化パターンの 2 entity への拡張」と「`#1` で残された Mock パススルー(`resetMockResearchAndHandoffOnly` / `clearMockResearchAndHandoffOnly`)の排除」の 2 軸。いずれも **`#1` の不完全領域を完成させる作業** であり、本 spec で新たな抽象は追加しない
- 内部 API として `TxRepos` を 4 entity に拡張するが、これは破壊的変更ではない(構造的型付けで既存呼出が継続動作)
- UI / `'use cache'` クエリ / Repository interface / `CACHE_TAGS` のいずれも無修正(Req 9.1〜9.5)

### 7.5 Open Questions の解決(自動承認に伴い暫定決定)
1. **Research の 1:1 DB 制約**: 付けない(Mock 慣習維持、Action 層担保)
2. **FK onDelete**: 既定の `restrict`(`#1` 整合)
3. **Server Action transaction 化のスコープ**: 必要な 3 箇所に限定
4. **README 更新**: `#1` の既存節を「research/handoffs を含む」に拡張する形で十分

