# Gap Analysis — deals-stores-db-migration

> 本ドキュメントは要件 (`requirements.md`) と既存コードベースのギャップを評価し、設計フェーズへ持ち込むべき判断材料を整理する分析メモである。**最終決定は `design.md` で行う**。

---

## 1. Current State Investigation

### 1.1 ドメイン関連の既存資産

| 領域 | パス | 役割・特徴 |
|---|---|---|
| 型定義 | `types/deal.ts` `types/store.ts` `types/stage.ts` | `Deal` / `Store` / `StageId` の単一の真実。`DealInput = Omit<Deal, "id" \| "created_at" \| "updated_at">`、`DealPatch = Partial<DealInput>` の派生型運用 |
| Repository interface | `lib/repositories/deal-repository.ts` `lib/repositories/store-repository.ts` | `list / get / create / update / delete` の薄い CRUD。`StoreRepository.list` は `StoreFilter` を受ける |
| Repository 集約 | `lib/repositories/index.ts` | 唯一の差し替え点。現状は Mock を直接束ねるだけ(env 分岐なし) |
| Mock 実装 | `lib/mock/db.ts` `lib/mock/deal.ts` `lib/mock/store.ts` `lib/mock/seed.ts` | `Symbol.for("__FW_SALES_MOCK_DB__")` を `globalThis` に紐付けて HMR 跨ぎ永続化。SEED は `daysAgo(N)` で動的生成 |
| Server Actions | `lib/actions/deal-actions.ts` `lib/actions/store-actions.ts` | FormData → Repository 呼び出し → `revalidateTag(_, "max")`。`createDealAction` / `updateDealAction` で Deal 更新 + Store ステージ同期(**現状は非トランザクション**) |
| データ移送 | `lib/actions/data-actions.ts` `app/api/export/route.ts` | `mockDb` を **直接 import**(`resetMockDb` / `clearMockDb` / `restoreMockDb` / `snapshotMockDb`) |
| Cache タグ集約 | `lib/cache.ts` | `CACHE_TAGS` 定数。`deals` / `deal:{id}` / `dealsByStore:{storeId}` / `stores` / `store:{id}` / `stats` / `kpi` / `pipeline` / `action-queue` |
| Queries (`'use cache'`) | `lib/queries/deals.ts` `lib/queries/stores.ts` 他 | `cacheTag(...)` 付与 + `repos.deal.list()` 等を呼ぶ薄いラッパ |
| ID / 日付ユーティリティ | `lib/utils/id.ts` (`generateId`) `lib/utils/date.ts` (`today()` / `daysAgo()`) | 既存表示処理が依存 |

### 1.2 アーキテクチャの支配的パターン
- **一方向依存**: `app` → `lib/queries` / `lib/actions` → `lib/repositories` → `lib/mock`(将来 `lib/db`)
- **`server-only` 隔離**: 永続化レイヤ・Repository・Action はすべて `import "server-only"` 宣言
- **Cache Components 規約**: 取得は `'use cache'` 関数で `cacheTag` 付与、変更後は `revalidateTag(tag, "max")` で stale-while-revalidate
- **Compound Components / RSC ↔ Client 橋渡し**: 本 Issue の責務外だが念のため文脈として記録

### 1.3 命名・コーディング規約
- ファイル: `kebab-case.ts(x)`、export は PascalCase / camelCase
- 列挙系: `as const` 配列 + `(typeof X)[number]` でリテラル型
- ID: `<entity>_<id>` 文字列(例: `deal_001`、`store_001`)、`generateId("deal")` で発番
- `created_at` / `updated_at`: `YYYY-MM-DD` 文字列(`text` 想定)
- TS: `strict` + `noUncheckedIndexedAccess`、`any` 禁止

### 1.4 統合面 / 運用面
- 認証なし(社内ツール、`assigned_sales` は文字列)。Supabase Service Role Key で直接 Postgres 接続を想定
- テストフレームワーク未導入(検証は `pnpm typecheck && pnpm lint && pnpm build` + 手動 E2E)
- 既存依存に DB 系パッケージは無い(`pnpm-lock.yaml` 確認済み)

---

## 2. Requirements Feasibility Analysis

### 2.1 要件 → 既存資産マッピング

| Req | 必要な技術要素 | 既存資産 | ギャップ種別 |
|---|---|---|---|
| **Req 1** 永続化 | 実 DB への CRUD | Repository interface のみ(実装は Mock) | **Missing**: Drizzle 実装ファイル群 (`lib/db/schema.ts`, `lib/db/client.ts`, `lib/db/deal-repository.ts`, `lib/db/store-repository.ts`) |
| **Req 2** CRUD と表示 | 既存 UI のまま動作 | UI / Server Actions / Queries は実装済み | **Constraint**: 既存 API シグネチャを破らないこと |
| **Req 3** Deal ↔ Store 整合性 | アトミックな複数テーブル更新 | 現状は **2 回の独立 await**(`deal-actions.ts:80-86` `:101-113`) | **Missing**: トランザクション境界(`db.transaction()`) |
| **Req 4** 集計反映 | キャッシュ失効戦略 | `revalidateTag(_, "max")` で運用済み | **Constraint**: Drizzle 実装内で副作用を起こさず、Action 層に責務集約 |
| **Req 5** Mock フォールバック | env 分岐 | `lib/repositories/index.ts` は固定 | **Missing**: `USE_MOCK_DB` を読む分岐ロジック |
| **Req 6** 起動時検証 | env 検証 + 接続確認 | 無し | **Missing**: 環境変数バリデーション(zod 等は未導入のため自前) + 接続失敗時の fail-fast |
| **Req 7** SEED 再現性 | 投入スクリプト | `SEED_*` 配列のみ(投入手段なし) | **Missing**: `scripts/seed.ts` + ベキ等性(upsert) |
| **Req 8** Export/Import/Reset | DB 経路追加 | `data-actions.ts` `app/api/export/route.ts` が **`mockDb` を直接 import** | **Constraint**: Mock 直接参照を抽象化する必要あり、ただし Research/Handoff は Mock のままなので **混在処理**(Deal/Store は DB 経由、Research/Handoff は Mock) |
| **Req 9** API 後方互換 | シグネチャ無修正 | 既存型・関数 | **Constraint**: `DealRepository` / `StoreRepository` の interface を Drizzle 実装で完全に満たす |
| **Req 10** ID/日付互換 | text PK + text 日付 | `generateId` / `today` 既存 | **Constraint**: Postgres 側を `text PRIMARY KEY` + `text` で定義 |
| **Req 11** 検証 | 標準コマンド + E2E | コマンド整備済み | **Unknown**: DB セットアップ手順の README 反映が必要 |

### 2.2 複雑性シグナル

- **CRUD 中心**: 大半は単純 CRUD で、Drizzle の標準操作で十分
- **トランザクション**: Deal 作成/更新と Store ステージ同期の 1 箇所のみ
- **混在処理**: Export/Import/Reset で「Deal/Store は DB、Research/Handoff は Mock」を扱う必要があり、唯一非自明な領域
- **Repository 切替の起動時 1 回固定**: 動的切替は不要(Req 5.4)で、シンプルに保てる

### 2.3 Research Needed (design 段階で深掘りすべき項目)
1. **Postgres ドライバ選定**: `postgres.js` (推奨) vs `node-postgres`。Next.js 16 / React 19 の Server Component / Server Action 動作実績、Edge Runtime 互換性、コネクション・プーリング戦略 (Supabase の PgBouncer モード仕様)
2. **Drizzle 0.x の最新 API**: `drizzle-orm` のスキーマ DSL、`db.transaction()` のシグネチャ、`migrate()` ヘルパの利用可否
3. **Supabase 接続オプション**: Session vs Transaction Pooler の選択基準。本 Issue は `assigned_sales` を user_id 化しないため Service Role Key 直接接続で問題ないが、後の認証 Issue を見据えて RLS バイパス前提の運用方針を design で固める
4. **Drizzle Kit のマイグレーション運用**: `generate` / `migrate` / `push` の使い分け、既存 SQL ファイルの管理場所(`drizzle/` 直下が標準)
5. **環境変数の Next.js 16 での扱い**: Server Action / Route Handler での `process.env.DATABASE_URL` 読み出し、`server-only` モジュール内での評価タイミング
6. **環境変数バリデーション**: 軽量 zod 導入の是非 (新規依存追加判断)。または自前の `assertEnv` ヘルパで十分か

---

## 3. Implementation Approach Options

### Option A: 既存 Repository 集約を最小拡張する(推奨)

**ねらい**: `lib/repositories/index.ts` の `repos` 定義を env 分岐に変えるだけで、UI / Server Action / Query 側は完全無修正。新設は `lib/db/` 一式と `scripts/seed.ts` のみ。

**変更点**:
- 新規: `lib/db/schema.ts` / `lib/db/client.ts` / `lib/db/deal-repository.ts` / `lib/db/store-repository.ts` / `drizzle.config.ts` / `scripts/seed.ts` / `.env.example`
- 修正: `lib/repositories/index.ts`(env 分岐)、`lib/actions/data-actions.ts`(Deal/Store のみ DB 経路)、`app/api/export/route.ts`(同左)、`lib/actions/deal-actions.ts`(transaction 化)
- Mock 関連はすべて維持

**互換性**:
- ✅ `DealRepository` / `StoreRepository` の interface を 1:1 で実装すれば既存 Action / Query は無修正
- ✅ `'use cache'` は Repository 越しに透過
- ⚠ `data-actions.ts` は Mock を直接参照しているため、Repository 抽象に追加メソッド (`bulkUpsert` 等) を生やすか、`data-actions.ts` 内で Mock/DB を if 分岐するかの判断が必要

**Trade-offs**:
- ✅ 既存パターンに完全に乗る、認知コスト最小
- ✅ Server Action のシグネチャ無修正(Req 9)
- ❌ `data-actions.ts` の Mock 直接参照を残すか別経路を増やすか、別途決定が必要

### Option B: Repository interface を拡張(`bulkUpsert` / `truncate` を追加)

**ねらい**: Export/Import/Reset を Repository 抽象に押し上げ、`data-actions.ts` から Mock 直接参照を排除する。

**変更点**:
- A の内容に加えて、`DealRepository` / `StoreRepository` に `bulkUpsert(items)` / `truncate()` を追加し、Mock / DB の両方で実装
- `data-actions.ts` は `repos.deal.truncate()` `repos.store.bulkUpsert(...)` 経由に書き換え

**互換性**:
- ✅ 抽象化レベルが揃い、長期保守性が向上
- ❌ Repository interface 変更は **Req 9 (interface 無修正)** に微妙に抵触(interface に **追加** であって既存メソッド変更はないため、設計判断で許容するかをユーザー確認)

**Trade-offs**:
- ✅ Mock 直接参照が消え、`structure.md` の「データソース単一窓口」原則と完全に整合
- ❌ 全 Repository (Research/Handoff も含む) に同じ追加実装が波及するリスク
- ❌ 短期スコープ (Deal/Store のみ DB 化) に対して過剰

### Option C: Hybrid — `data-actions.ts` を分割

**ねらい**: Mock 専用処理(Research/Handoff)と、新たな DB 経路処理(Deal/Store) を別ファイルに分け、暫定的に両者を呼び分ける。Research/Handoff 側を将来 DB 化した際に統合する前提のフェーズ運用。

**変更点**:
- `lib/actions/data-actions.ts` から Deal/Store 関連処理を `lib/actions/data-actions-db.ts` に切り出す or `data-actions.ts` 内で Mock/DB の if 分岐
- Repository には手を入れない
- Phase 1: Deal/Store のみ DB 経路、Research/Handoff は Mock 経路を継続

**Trade-offs**:
- ✅ Research/Handoff DB 化(次 Issue)時に自然に統合できる
- ✅ Repository interface を変更しないため Req 9 を厳密に満たす
- ❌ 一時的にファイル数が増え、混在期間の認知コスト増

---

## 4. Effort & Risk

| 軸 | 評価 | 根拠 |
|---|---|---|
| **Effort** | **M (3–7 日)** | テーブル 2 つの CRUD + transaction 1 箇所 + Export/Import/Reset の DB 経路 + Drizzle Kit 初期セットアップ + Supabase プロビジョニング。新規依存導入と未経験技術(Drizzle が初導入なら)があるため S ではなく M |
| **Risk** | **Medium** | Drizzle / Supabase は実績豊富で情報多いが本プロジェクト初導入。`'use cache'` + Drizzle の組み合わせ動作確認が要、コネクション・プーリングと Server Action の相性に未知。ロジック自体は単純 CRUD なので High ではない |

**Risk 詳細**:
- 🟡 Drizzle スキーマと既存 TypeScript 型の整合(特に nullable / number / 列挙型)を 1:1 で取れるか
- 🟡 Supabase Pooler モード選択ミス時のコネクション枯渇 → `postgres.js` の `max` 設定で抑止
- 🟢 Repository interface は薄く CRUD のみ、移植は機械的
- 🟢 Cache タグ戦略は無修正で透過するため再設計不要
- 🟢 認証スコープが無いため RLS 設計の悩みなし(別 Issue)

---

## 5. Recommendations for Design Phase

### 5.1 Preferred Approach
**Option A(最小拡張)を推奨**。

**理由**:
- 要件 Req 9(API 後方互換)に最も厳密に適合
- スコープ最小、レビュー容易
- Research/Handoff も将来 DB 化する際は同じ Option A を反復するだけで拡張可能
- `data-actions.ts` の Mock 直接参照は **設計時に Option C のフェーズ運用 (data-actions-db.ts 分離) を取り込む** ことで、Repository interface 変更を避けつつ整理できる

### 5.2 Key Decisions to Lock in `design.md`
1. **ドライバ**: `postgres.js`(Drizzle 公式推奨、Supabase Pooler 互換、軽量)
2. **接続モード**: Supabase **Transaction Pooler**(Server Action のステートレス特性に合致、`max=1` で `prepare: false` 推奨パターン)
3. **マイグレーション運用**: `drizzle-kit generate` で SQL 保存 → `drizzle-kit migrate` で適用。SQL は `drizzle/` ディレクトリにコミット
4. **トランザクション境界**: `createDealAction` `updateDealAction` 内で `db.transaction(async (tx) => { ... })` を呼び、その中で `dealRepo.create(tx, ...)` `storeRepo.update(tx, ...)` を実行できるよう Repository 実装は **tx を受け取れる形にオーバーロード**
5. **env バリデーション**: 新規依存は避け、`lib/env.ts` で `assertEnv()` 自前ヘルパ(環境変数欠落時に明確なメッセージで throw)
6. **SEED スクリプト**: `pnpm tsx scripts/seed.ts` で実行。`ON CONFLICT DO UPDATE` でベキ等化
7. **Export/Import/Reset 整理戦略**: Option C のフェーズ運用を採用し、`data-actions.ts` 内で `USE_MOCK_DB` を見て分岐(Mock 専用処理は維持、Deal/Store のみ DB 経路を追加)

### 5.3 Research Items を design へ持ち越し
- `postgres.js` v3 の Next.js 16 App Router での既知問題(コネクションリーク報告等の最新状況)
- `drizzle-orm` 最新版の `text PRIMARY KEY` + `$defaultFn` での ID 生成パターン
- Supabase 無料プラン枠と接続数上限の実用情報
- `tsx` を新規 devDependency として追加するか、`node --import tsx scripts/seed.ts` で済ませるかの選択

### 5.4 Open Questions(ユーザー確認が望ましい)
1. **Supabase プロジェクト**: 既に作成済みか、design 段階で別途プロビジョニング指示を出すか
2. **`tsx` 依存の追加可否**: `scripts/seed.ts` を TS で書く前提として必要。CLAUDE.md の「外部ライブラリ追加には慎重」原則に該当
3. **DB マイグレーション SQL のコミット**: `drizzle/` 配下のファイルを git 管理するか(通常は YES)
4. **本番運用想定**: 本 Issue は MVP として Service Role Key 直接接続を採るが、本番展開時は別 Issue (RLS / 認証) で再設計する旨を design に明記する想定でよいか

---

## 6. Output Checklist (Compliance)

- ✅ Requirement-to-Asset Map(11 件すべてに gap 種別タグ)
- ✅ Options A/B/C と trade-off
- ✅ Effort M / Risk Medium と一行根拠
- ✅ Preferred approach (Option A) と key decisions
- ✅ Research Needed と Open Questions の分離

---

## 7. Design Synthesis Outcomes (`/kiro-spec-design` 時追記)

### 7.1 Generalization
- `DealRepository` と `StoreRepository` は CRUD 形が同型 (`list / get / create / update / delete`)。Drizzle 実装は **同一の構造的パターン**(executor 引数で tx 切替可能なファクトリ)で書く。ただし共通の `BaseRepository<T>` 抽象は導入しない(エンティティが 2 つしかなく、抽象化のコストが利得を上回る)。
- 「Mock を直接参照する経路の整理」は本 Issue では Deal/Store のみ DB 経路を追加する形に留め、Research/Handoff DB 化(別 Issue)で同じパターンを反復することで Repository 抽象に再合流させる。

### 7.2 Build vs Adopt
| 領域 | 決定 | 根拠 |
|---|---|---|
| ORM | **Adopt: `drizzle-orm` 0.x** | Postgres 型推論が強く、`text PRIMARY KEY` + 既存 ID 体系と相性が良い。Edge / Node 両対応 |
| DB ドライバ | **Adopt: `postgres` (postgres.js) v3.x** | Drizzle 公式推奨、Supabase Pooler 互換、Server Action のステートレス実行に適合 |
| マイグレーション CLI | **Adopt: `drizzle-kit`(devDep)** | スキーマ → SQL 自動生成、`migrate()` ランタイムヘルパも提供 |
| TS スクリプト実行 | **Adopt: `tsx`(devDep)** | `scripts/seed.ts` を TS のまま実行。`node --experimental-strip-types` (Node 22+) は機能限定のため不採用 |
| env バリデーション | **Build: 自前 `assertEnv` ヘルパ** | zod 導入はオーバースペック (CLAUDE.md「外部ライブラリ追加は最小限」)。10 行未満のヘルパで十分 |
| 認証/RLS | **Out (別 Issue)** | 本 Issue は MVP として Service Role Key 直接接続 |

### 7.3 Simplification
- **Repository tx 伝搬**: interface に tx 引数を追加せず、`makeDealRepo(executor)` ファクトリで `db` または `tx` を渡す内部実装パターンを採用。interface (Req 9) は無修正
- **`data-actions.ts` の整理**: 別ファイル分割(Option C)はせず、`USE_MOCK_DB` を見て if 分岐する 1 ファイル運用とする (Research/Handoff の DB 化時に再整理)
- **Migration 自動実行**: 起動時の自動 migrate は実装せず、開発者が `pnpm drizzle-kit migrate` を明示実行する運用 (production 事故防止 + シンプル)
- **環境変数の動的切替禁止**: `repos` は起動時に 1 度だけ env を見て確定。リクエストごとの分岐はしない (Req 5.4)

### 7.4 Boundary Synthesis
- 本 Issue が「Mock vs DB の二重実装期間」を明示的に許容することで、Research/Handoff のスコープ外問題を boundary レベルで隔離
- `createDealAction` の transaction 化は内部実装の改善 (Req 9 のシグネチャ無修正に抵触しない)
- Repository ファクトリ `makeDealRepo / makeStoreRepo` は **本 spec が新設する内部 API**。upstream (Action / Query) からは見えない

### 7.5 Open Questions の解決(自動承認に伴い暫定決定)
1. **Supabase プロジェクト**: 別途プロビジョニング前提。design.md にセットアップ手順を Migration Strategy として記載
2. **`tsx` 追加可否**: 採用 (devDep)。SEED スクリプト用途に限定し、ランタイム依存は増えない
3. **Drizzle SQL コミット**: `drizzle/` 配下を git 管理(team で履歴共有)
4. **本番運用**: 本 Issue は MVP 範囲。RLS / 認証は別 Issue で対応する旨を design.md に明記
