# Design Document

## Overview

**Purpose**: Pipeline 画面の「営業担当」フィルタを backend (Repository 層) まで伝播させ、URL クエリ `sales` が実際に絞り込みに効くようにする。

**Users**: 営業担当者が Pipeline 画面の KanbanBoard で自分または特定担当者の店舗のみを抽出する用途を持つ。社内ツール利用者全員(現在は単一ロール)。

**Impact**: 既存の `StoreFilter` 型に optional フィールドを 1 つ追加し、DB / Mock 双方の Repository 実装に等価条件を 1 行ずつ追加、Pipeline ページから URL パラメータを filter に詰める分岐を追加する非破壊的な追加変更。新規ファイル無し。

### Goals

- URL クエリ `sales` の値を Pipeline ページ → Repository 層まで一気通貫で伝播させ、backend で実際の絞り込みを行う
- KanbanBoard の全ステージカラムが同一のフィルタ済み店舗集合で再描画される(Suspense / Cache Components の既存挙動に乗る)
- `app/(main)/pipeline/page.tsx:27` に残る「sales フィルタ → 後日」相当の暫定 TODO コメントを撤去する

### Non-Goals

- Stores 一覧画面 (`/stores`) や他画面の `StoreFilter` 利用箇所のフィルタ仕様変更
- 担当者の表記揺れ正規化(全角/半角、前後空白、大文字小文字)
- 担当者マスタ ID 化(文字列 → FK)。後続 Issue (`auth-and-notifications` 系列) で対応
- 複数担当者選択 UI(本機能は単一値選択を維持)
- 自動テストフレームワーク導入(プロジェクト方針: typecheck + lint + build + 手動確認)

## Boundary Commitments

### This Spec Owns

- `types/store.ts` の `StoreFilter` 型における `sales?: string` フィールドの追加と意味定義(完全一致での担当者絞り込み)
- `lib/db/store-repository.ts` の `buildFilterConditions` における `sales` 条件追加(`eq(stores.assigned_sales, filter.sales)`)
- `lib/mock/store.ts` の `matches` における `sales` 条件追加(`store.assigned_sales === filter.sales`)
- `app/(main)/pipeline/page.tsx` における `searchParams.sales` → `filter.sales` の変換ロジックと、暫定 TODO コメントの撤去
- 上記 4 ファイル変更を通じた Pipeline 画面の `sales` フィルタ動作

### Out of Boundary

- `lib/repositories/store-repository.ts` の interface 形状変更(`StoreFilter` の型拡張で interface は実質追従するため、interface ファイル自体の修正は行わない)
- `pipeline-filters.tsx` の UI ロジック変更(URL への `sales` 書き込みは既に動作しており、変更不要)
- KanbanBoard / loadColumns / getPipelineColumns の内部実装変更(`StoreFilter` を不透明に通過させるだけで sales を解釈しない)
- `/stores` 画面、Stores Table、その他 `StoreFilter` を利用する画面のフィルタ拡張
- DB スキーマ変更(`stores.assigned_sales` カラムは既存)
- Cache タグの追加・分割(既存の `CACHE_TAGS.stores` / `CACHE_TAGS.pipeline` をそのまま利用)
- 担当者マスタ化に伴う ID 移行・表記揺れ正規化

### Allowed Dependencies

- 既存の `@/types/store` 型エクスポート(同一ファイル内拡張のため)
- 既存の `drizzle-orm` の `eq` ヘルパ(`buildFilterConditions` で他フィールドが既に使用)
- 既存の `lib/domain/staff` の `SALES` 配列(UI ドロップダウンで使用済み。本設計では参照しない)
- Next.js App Router `searchParams` Promise(Pipeline ページで他フィールドが既に利用)
- 既存の Suspense `key={JSON.stringify(filter)}`(filter 変更時の再評価に依拠)
- 既存の `'use cache'` + `cacheTag(CACHE_TAGS.stores, CACHE_TAGS.pipeline)`(filter 値が cache key に自動的に組み込まれる)

### Revalidation Triggers

- `StoreFilter` の形状変更(他フィールドの型変更、必須化、リネーム): `StoreFilter` を消費する全画面・Repository 実装の再確認が必要
- `stores.assigned_sales` カラムの型変更(string → ID FK): 本機能の `eq()` / `===` を ID 比較に置き換える設計差し替えが必要
- 担当者マスタ ID 化が完了したタイミング: 本機能の文字列完全一致を ID 比較に移行する後続作業のトリガ
- `lib/queries/pipeline.ts` の `getPipelineColumns(filter)` 契約変更(filter 引数の解釈や戻り値構造変更): KanbanBoard と本機能の伝播経路を再検証
- `lib/repositories/index.ts` の `repos.stores` 差し替え点変更: DB / Mock 両実装で sales 条件が一貫しているかの再確認

## Architecture

### Existing Architecture Analysis

本機能は既存の Repository パターンと Cache Components 戦略にそのまま乗る追加変更である。新規ドメイン境界・新規レイヤー導入は無い。

- **Repository 抽象**: `lib/repositories/store-repository.ts` の `StoreRepository` interface(`list(filter?: StoreFilter): Promise<Store[]>`)を、DB 実装 (`lib/db/store-repository.ts`) と Mock 実装 (`lib/mock/store.ts`) の双方が満たす。`StoreFilter` を拡張すると両実装が型レベルで追従する。
- **Cache Components**: Pipeline ページは `<Suspense key={JSON.stringify(filter)}>` でフィルタ変更時にバウンダリを再生成し、`loadColumns(filter)`(`'use cache'`)が filter 値を引数として受けることで Cache Components が自動的に新しいキャッシュキーを認識する。
- **Server Actions / 変更系**: 本機能は読み取り系のみで Server Actions に変更は無い。`revalidateTag` の追加も不要。
- **既存フィルタ条件パターン**: DB 実装は `if (filter.X) conditions.push(eq(stores.X, filter.X))` の素直な蓄積、Mock 実装は `if (filter.X && store.X !== filter.X) return false` の早期リターン。`sales` も同パターンを踏襲する。

### Architecture Pattern & Boundary Map

Simple Addition のため diagram 不要。データの流れは以下の単線:

```
URL ?sales=<name>
  → app/(main)/pipeline/page.tsx (sp.sales → filter.sales 詰替え)
    → <Suspense key={JSON.stringify(filter)}>
      → KanbanBoard(filter)
        → loadColumns(filter)  // 'use cache' + cacheTag
          → getPipelineColumns(filter)
            → repos.stores.list(filter)  // DB or Mock
              → buildFilterConditions / matches  // sales 条件適用
```

filter.sales が空文字または未指定の場合は条件追加せず、既存の他フィルタ条件のみで絞り込む。

### Technology Stack

| Layer | Choice / Version | Role in Feature | Notes |
|-------|------------------|-----------------|-------|
| Frontend (RSC) | Next.js 16.2.4 App Router | `searchParams` Promise から `sales` を読み出し、Suspense `key` で再描画契機を作る | 既存挙動に乗る、追加依存無し |
| Backend / Domain | TypeScript 5+ (strict, `noUncheckedIndexedAccess`) | `StoreFilter` 型に optional フィールドを追加 | 非破壊的追加 |
| Data / Storage | Drizzle ORM (`eq`, `and`) + In-memory Map (Mock) | DB / Mock 両実装に `sales` 条件を追加 | 既存パターン踏襲 |
| Infrastructure / Runtime | Cache Components (`'use cache'`, `cacheTag(CACHE_TAGS.stores, CACHE_TAGS.pipeline)`) | filter 値を cache key として stale-while-revalidate | タグ追加無し、自動再キー化 |

新規ライブラリ追加は無い。AGENTS.md の「外部ライブラリ追加は原則禁止」方針に整合。

## File Structure Plan

### Modified Files

- **`types/store.ts`** — `StoreFilter` interface に `sales?: string` フィールドを追加(他フィールドと同様 optional の文字列型。`assigned_sales` カラムと完全一致で比較されることをコメントで明記)。
- **`lib/db/store-repository.ts`** — `buildFilterConditions` 内で他の `eq()` 条件と並列に `if (filter.sales) conditions.push(eq(stores.assigned_sales, filter.sales));` を追加。空文字は `if` で除外される(falsy 判定)。
- **`lib/mock/store.ts`** — `matches` 関数の早期リターンチェーンに `if (filter.sales && store.assigned_sales !== filter.sales) return false;` を追加。
- **`app/(main)/pipeline/page.tsx`** — `if (sp.sales) filter.sales = sp.sales;` を `searchParams` 詰替えブロックに追加。`// sales フィルタはクライアント側カラム表示後に絞り込む(KanbanBoardでは未対応 → 後日)` コメント(line 27 相当)を削除。

### New Files

無し。

### Untouched (in scope of awareness, out of scope of change)

- `lib/repositories/store-repository.ts` (interface): `StoreFilter` 型拡張で型レベル追従するため、interface ファイル自体は無修正
- `app/(main)/pipeline/_components/pipeline-filters.tsx`: 既に URL に `sales` を書き込んでいる(変更不要)
- `app/(main)/pipeline/_components/kanban-board.tsx`: `filter` を不透明に Repository に渡すだけで `sales` を解釈しない
- `lib/queries/pipeline.ts`: `getPipelineColumns(filter)` は filter を Repository に渡すだけで `sales` を解釈しない
- `lib/cache.ts`: 既存 `CACHE_TAGS.stores` / `CACHE_TAGS.pipeline` を流用、追加無し

## Requirements Traceability

| Requirement | Summary | Components | Interfaces | Flows |
|-------------|---------|------------|------------|-------|
| 1.1 | UI 操作で sales が backend に効く | PipelinePage, buildFilterConditions, matches | `searchParams.sales` → `filter.sales`、`list(filter)` | URL → filter → Repo |
| 1.2 | URL 直アクセスで sales が効く | PipelinePage | 同上 | 同上 |
| 1.3 | sales 未指定/空文字で絞り込まない | PipelinePage (`if (sp.sales)`)、buildFilterConditions、matches | 条件追加スキップ | - |
| 1.4 | 完全一致のみ(空白/全角半角/大小文字差は除外) | buildFilterConditions (`eq()`)、matches (`===`) | - | - |
| 2.1 | KanbanBoard 全カラムで sales 反映 | KanbanBoard、loadColumns | `'use cache'` + cacheTag、Repo 結果がステージ別に分配 | filter 値が cache key 化 |
| 2.2 | 各カラムの件数・空状態が反映 | KanbanBoard Column(既存) | `column.stores.length`、空状態メッセージ | - |
| 2.3 | 変更/解除で全カラム同時再描画 | PipelinePage Suspense | `key={JSON.stringify(filter)}` | Suspense 境界再生成 |
| 3.1 | 他フィルタとの AND | buildFilterConditions、matches | `and(conditions...)`、早期リターン連鎖 | - |
| 3.2 | sales 未指定でも他フィルタ挙動不変 | buildFilterConditions、matches | 既存ロジック温存 | - |
| 3.3 | フィルタ解除で URL から除去 | pipeline-filters.tsx (既存)、PipelinePage | `URLSearchParams.delete("sales")` (既存) | - |
| 4.1 | Pipeline のみが対象 | File Structure Plan の Modified 4 ファイル | - | - |
| 4.2 | 文字列完全一致 | buildFilterConditions、matches | `eq()` / `===` | - |
| 4.3 | TODO コメント撤去 | PipelinePage edit | - | - |
| 4.4 | ID 移行を本機能で先行させない | Out of Boundary 明記 | - | - |

## Components and Interfaces

### Types Layer

#### StoreFilter (Modified)

| Field | Detail |
|-------|--------|
| Intent | Pipeline 画面と Repository 層の間で受け渡されるフィルタ条件オブジェクト |
| Requirements | 1.1, 1.4, 4.2, 4.4 |

**Responsibilities & Constraints**
- すべてのフィールドは optional。空・未指定は「絞り込まない」を意味する
- 文字列フィールド(`q`, `sales`)は受け入れ側で空文字を「未指定」と同等に扱う(`if (filter.sales)` の falsy 判定)
- 担当者マスタ ID 化が将来発生しても、本機能では `sales: string` を維持(Req 4.4)

**Contracts**: State [x]

##### State Definition
```typescript
export interface StoreFilter {
  q?: string;
  stage?: StageId;
  channel?: Channel;
  priority?: Priority;
  /** 営業担当者の完全一致絞り込み。`assigned_sales` カラムと厳密一致 (===, eq()) で比較する。 */
  sales?: string;
}
```

**Implementation Notes**
- Integration: `lib/db/store-repository.ts` と `lib/mock/store.ts` の両方が同タイミングで対応する。Mock のみ・DB のみの片肺対応は禁止
- Validation: 値の正規化(trim、case fold 等)は行わない。Issue のリスク欄に記載の通り、表記揺れは弾く挙動を意図する
- Risks: `assigned_sales` が将来 ID 列に変わると `eq()` / `===` の意味が破綻 → Revalidation Triggers に記載済み

### Data Layer

#### buildFilterConditions (DB)

| Field | Detail |
|-------|--------|
| Intent | `StoreFilter` から Drizzle `SQL` WHERE 条件を構築 |
| Requirements | 1.1, 1.2, 1.3, 1.4, 3.1, 4.2 |

**Responsibilities & Constraints**
- 既存の `stage` / `priority` / `channel` と同一パターンで `sales` 条件を蓄積
- 空文字は `if (filter.sales)` の falsy 判定で除外され条件追加されない(Req 1.3)
- 全条件は `and(...)` で AND 結合(Req 3.1)

**Contracts**: Service [x]

##### Service Interface (差分のみ)
```typescript
function buildFilterConditions(filter: StoreFilter): SQL | undefined {
  const conditions: SQL[] = [];
  if (filter.stage) conditions.push(eq(stores.stage, filter.stage));
  if (filter.priority) conditions.push(eq(stores.priority, filter.priority));
  if (filter.channel) conditions.push(eq(stores.channel, filter.channel));
  if (filter.sales) conditions.push(eq(stores.assigned_sales, filter.sales)); // ← 追加
  // q 条件は既存通り
  if (filter.q && filter.q.trim() !== "") {
    /* 既存の ILIKE OR 結合 */
  }
  if (conditions.length === 0) return undefined;
  return and(...conditions);
}
```
- Preconditions: `filter` は型 `StoreFilter` に従う
- Postconditions: 条件が一つも無ければ `undefined`(`where` 句省略)。あれば AND 結合した `SQL`
- Invariants: `eq()` は厳密比較で大文字小文字差・空白差を解決しない(Req 1.4)

**Implementation Notes**
- Integration: 既存パターンの一行追加。位置は他 `eq()` 条件と並列で、`q` 条件より前
- Validation: 不要(型ガード相当)
- Risks: 無し(既存の和集合に追加するだけ)

#### matches (Mock)

| Field | Detail |
|-------|--------|
| Intent | `StoreFilter` と `Store` の照合判定(早期リターン式) |
| Requirements | 1.1, 1.2, 1.3, 1.4, 3.1, 4.2 |

**Contracts**: Service [x]

##### Service Interface (差分のみ)
```typescript
function matches(store: Store, filter: StoreFilter): boolean {
  if (filter.stage && store.stage !== filter.stage) return false;
  if (filter.priority && store.priority !== filter.priority) return false;
  if (filter.channel && store.channel !== filter.channel) return false;
  if (filter.sales && store.assigned_sales !== filter.sales) return false; // ← 追加
  if (filter.q) {
    /* 既存の trim + lowercase + 6 カラム検索 */
  }
  return true;
}
```
- Preconditions: `filter` は型 `StoreFilter` に従う、`store` は `Store`
- Postconditions: 全条件を満たすとき `true`
- Invariants: 大小文字・空白の差異を吸収しない(`===` 厳密比較。Req 1.4)。DB 実装と挙動を一致させる

**Implementation Notes**
- Integration: 既存パターンの一行追加。位置は他 `===` 比較条件と並列で、`q` 条件より前
- Validation: 不要
- Risks: DB 実装と Mock 実装の比較演算子の整合性(`eq()` vs `===`)はどちらも文字列の SQL 等値判定 / JS 等値判定で表記揺れに不寛容な挙動という意味では一致する

### Frontend Layer

#### PipelinePage (Modified)

| Field | Detail |
|-------|--------|
| Intent | URL `searchParams` を `StoreFilter` に変換し KanbanBoard に渡す Server Component |
| Requirements | 1.1, 1.2, 1.3, 2.3, 3.3, 4.3 |

**Responsibilities & Constraints**
- `sp.sales` が truthy のときのみ `filter.sales` に詰める(Req 1.3 の空文字スキップ動作)
- 既存の Suspense `key={JSON.stringify(filter)}` を維持し、フィルタ変更時に KanbanBoard が再描画されることを保証(Req 2.3)
- line 27 相当の暫定 TODO コメントを削除(Req 4.3)

**Contracts**: State [x]

##### State Definition (差分のみ)
```typescript
const sp = await searchParams;
const filter: StoreFilter = {};
if (sp.q) filter.q = sp.q;
if (sp.priority && (PRIORITIES as readonly string[]).includes(sp.priority)) {
  filter.priority = sp.priority as Priority;
}
if (sp.sales) filter.sales = sp.sales; // ← 追加
// 「sales フィルタは…後日」コメントは削除
```

**Implementation Notes**
- Integration: 既存パターンの一行追加。priority 詰替えと違い列挙チェックは不要(任意の文字列値を受け入れ、未登録担当者は単に該当無しとなる)
- Validation: SALES 配列との照合は行わない。理由: マスタが未確定で表記揺れ正規化を Out of Boundary としているため(Req 4.2, 4.4)。未登録値が指定されると結果が空集合になる挙動が仕様
- Risks: 無し

#### KanbanBoard (Unchanged)

| Field | Detail |
|-------|--------|
| Intent | (変更なし) `filter` を不透明に Repository まで通過させ、ステージ別カラムを描画 |
| Requirements | 2.1, 2.2 |

**Implementation Notes**
- 本機能では本ファイルを変更しない。`filter` 値の cache key 化は `'use cache'` の自動キー導出と Suspense `key` の組合せで既に成立しているため

## Data Models

### Domain Model

`StoreFilter` は値オブジェクト(query params)。`sales?: string` の追加は非破壊的な optional 拡張のため、既存の全 `StoreFilter` 構築箇所(他画面)に影響を与えない。

### Logical Data Model

DB スキーマ無変更。`stores.assigned_sales` は既存の `text` 列で、本機能はその列に対する `eq()` 比較を追加するのみ。インデックス追加も不要(Pipeline 画面の店舗数規模では不要であり、追加すると本 Issue の境界を超える)。

## Error Handling

### Error Strategy

- **未登録担当者値**: SALES マスタに無い `sales` 値が指定された場合(URL 直叩き等)、エラーではなく「該当無し」(空集合)として扱う。これは Req 1.4 の完全一致仕様の自然な帰結
- **空文字**: `if (filter.sales)` の falsy 判定で「未指定」と同等扱い(Req 1.3)
- **DB エラー**: 既存 Repository 実装のエラー伝播に従う(本機能で追加処理しない)
- **検証層**: zod 等のスキーマ検証は導入しない(社内ツール、URL 直叩き者は基本的に開発者のみ)

### Monitoring

本機能は読み取り系で副作用が無いため、追加のロギング・モニタリングは導入しない。既存の Next.js dev / build エラーログで十分。

## Testing Strategy

プロジェクトには自動テストフレームワークが未導入(tech.md)。検証は **`pnpm typecheck` + `pnpm lint` + `pnpm build` + ブラウザ動作確認** で行う。

### Type & Build Verification

- `pnpm typecheck`: `StoreFilter` 拡張により他箇所で型エラーが発生していないこと
- `pnpm lint`: ESLint(`next/core-web-vitals` + `eslint-config-next/typescript`)が通ること
- `pnpm build`: Next.js 本番ビルドが通ること(Cache Components の cache key 整合を含む)

### Manual Verification (Acceptance Criteria 直マッピング)

| 検証項目 | 操作 | 期待結果 | Req |
|---------|------|---------|-----|
| UI 選択 → backend 反映 | Pipeline 画面で「営業担当」ドロップダウンから担当者選択 | URL に `?sales=<名前>` が追加され、KanbanBoard 全カラムが当該担当者の店舗のみ表示 | 1.1, 2.1, 2.3 |
| URL 直接アクセス | アドレスバーに `/pipeline?sales=<担当者名>` を直接入力 | 当該担当者の店舗のみ表示 | 1.2 |
| sales 未指定 | `/pipeline`(クエリ無し)を開く | 全件表示(他フィルタが無いとき) | 1.3 |
| sales=空文字 | `/pipeline?sales=` を開く | 全件表示(空文字は未指定扱い) | 1.3 |
| 大文字小文字差 | 「YAMADA」が `assigned_sales` に登録された店舗で `?sales=Yamada` を指定 | 当該店舗が表示されない | 1.4 |
| 前後空白差 | `?sales=%20%E5%B1%B1%E7%94%B0%20`(前後空白入り)を指定 | 当該店舗が表示されない | 1.4 |
| 他フィルタとの AND | `/pipeline?sales=<名前>&priority=高` | 両条件 AND で絞り込まれた結果のみ表示 | 3.1 |
| 既存挙動の不変 | sales 未指定で priority のみ指定 | 従来通り priority のみ絞り込み | 3.2 |
| フィルタ解除 | UI で「担当者すべて」に戻す | URL から `sales` クエリが消え、残りのフィルタで絞り込み | 3.3 |
| カラム件数表示 | sales 適用前後で各ステージカラムのヘッダ件数を確認 | フィルタ適用後の件数で更新される | 2.2 |
| カラム再描画整合 | sales を変更した直後 | すべてのカラムが同時に新データで描画される(混在状態が発生しない) | 2.3 |
| 他画面への影響無し | `/stores` 画面のフィルタ操作 | 従来通り動作(変化なし) | 4.1 |
| TODO コメント撤去 | `git grep "sales フィルタ.*後日" app/\(main\)/pipeline/` | 一致無し | 4.3 |
| Mock / DB 一貫性 | Mock モード起動と DB モード起動の双方で同 URL を開く | 同じフィルタ結果(完全一致動作の一致) | 1.4, 3.1 |
