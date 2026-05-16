# Project Structure

## Organization Philosophy

**役割ごとのレイヤード構成** + **App Router の Route Groups による画面シェル分離**。

- `app/` … ルーティングとページ。`(main)` Route Group で共通シェル(サイドバー + トップバー)を被せる
- `components/` … 横断利用される UI(`ui/` / `feature/` / `layout/` の三層)
- `lib/` … サーバーロジックを役割でレイヤー分割(`domain` → `repositories` → `mock` / 将来の `db` → `queries` / `actions`)
- `types/` … ドメイン型のみを集約。`index.ts` から再 export

依存方向は一方向: `app` → `components` / `lib` / `types`、`lib/queries` `lib/actions` → `lib/repositories` → `lib/mock`(or 将来の `lib/db`)。**逆方向 import は禁止**。

## Directory Patterns

### App Router (`app/`)
**Purpose**: ルーティング、ページ、レイアウト、API Routes
- `app/(main)/` Route Group 配下に主要画面(dashboard / stores / research / pipeline / actions / deals / handoffs / kpi / settings)を配置
- 各画面の `page.tsx` は **Server Component が既定**。データ取得は `lib/queries/*` の `'use cache'` 関数を呼ぶ
- `loading.tsx` / `error.tsx` / `not-found.tsx` は `(main)` の直下に配置し、全画面共通の境界を構成
- API Routes は `app/api/*/route.ts`(現状は Export のみ)

### UI Components (`components/ui/`)
**Purpose**: ドメインに依存しない再利用可能なプリミティブ(Button / Card / Modal / Tabs / Toast 等)
- 命名は機能(Button, Input, Modal …)。ファイル名は `kebab-case.tsx`、export は PascalCase
- バリアントは `cva` で定義し、`type` を export
- Compound Components は名前空間付き API(`Card.Header` 等)で提供

### Feature Components (`components/feature/`)
**Purpose**: ドメイン語彙を持つ表示要素(Stage バッジ / Channel バッジ / Priority バッジ / Service タグ等)
- ロジックは持たず、props を受けて表示するだけに留める

### Layout (`components/layout/`)
**Purpose**: アプリシェル(Sidebar / Topbar / NavBadges)
- Sidebar / Topbar は Client Component、NavBadges は RSC

### Domain Constants (`lib/domain/`)
**Purpose**: 業務語彙の定数とヘルパ(STAGES / SERVICES / STAFF / channel 判定 / nav 定義)
- `as const` 配列 + `(typeof X)[number]` パターンで型を派生

### Repositories (`lib/repositories/`)
**Purpose**: データアクセスの抽象 interface のみを定義する境界層
- 1 ドメイン = 1 ファイル(`store-repository.ts` 等)
- `index.ts` で `repos` オブジェクトに集約 ← **DB 切替時の唯一の差し替え点**

### Mock Implementation (`lib/mock/`)
**Purpose**: Repository interface の Mock 実装(インメモリ Map + globalThis 永続化 + SEED)
- `db.ts` が共有ストア、各 `*.ts` が個別 Repository 実装
- `seed.ts` に初期データ(SEED_STORES / SEED_DEALS 等)
- DB 化後も E2E / フォールバック用に維持する想定

### Queries (`lib/queries/`)
**Purpose**: 取得系の `'use cache'` 関数群
- `cacheTag(CACHE_TAGS.x)` を必ず付与し、`repos` 越しにデータ取得
- 集計関数(stats / kpi / pipeline / action-queue)もここに置く

### Actions (`lib/actions/`)
**Purpose**: Server Actions(`"use server"`)
- 1 ドメイン = 1 ファイル + `_helpers.ts` で共通化
- 戻り値は `ActionResult<T>` 型に統一、変更後は `revalidateTag(tag, "max")` を呼ぶ
- 関連スコープを一括 invalidate するヘルパ(例: `invalidateDealScopes`)を各ファイル内で定義

### Types (`types/`)
**Purpose**: ドメイン型の単一の真実
- 各ファイルから `index.ts` が `export *`
- 派生型(`*Input` = `Omit<T, 'id' | 'created_at' | 'updated_at'>`、`*Patch` = `Partial<*Input>`)で CRUD を表現

## Naming Conventions

- **ファイル**: `kebab-case.ts(x)`(例: `deal-actions.ts`, `stage-badge.tsx`)
- **React Component**: PascalCase(export 名)
- **関数 / 変数**: camelCase
- **定数 (列挙系)**: SCREAMING_SNAKE_CASE な配列(例: `STAGES`, `CACHE_TAGS`, `SEED_STORES`)
- **型エイリアス**: PascalCase(例: `Deal`, `StageId`, `ActionResult`)
- **DB ID プレフィックス**: `<entity>_<id>` 形式の文字列(例: `deal_001`, `store_001`)。`generateId("deal")` で発番

## Import Organization

```typescript
import "server-only";                            // server-only 宣言(該当ファイルのみ最上部)
import { cacheTag } from "next/cache";            // 1. Node / Next 標準
import { repos } from "@/lib/repositories";      // 2. 絶対パス(@/...)
import { CACHE_TAGS } from "@/lib/cache";
import type { Deal } from "@/types/deal";        // 3. 型 import は別ブロック
import { localHelper } from "./_helpers";        // 4. 同一ディレクトリ内のみ相対 import
```

**Path Aliases**:
- `@/*` → リポジトリルート(`tsconfig.json` `paths`)

## Code Organization Principles

- **Server / Client 境界の明示**: ファイル冒頭で `import "server-only"` / `"use server"` / `"use client"` を必ず宣言
- **DB 切替の単一窓口**: データソースに触れる唯一の場所は `lib/repositories/index.ts` の `repos`。Action / Query から Mock を直接 import しない(例外: `data-actions.ts` の Export/Import/Reset は Mock 実装の特権処理として直接触る)
- **Cache タグの集約**: 新規タグは必ず `lib/cache.ts` の `CACHE_TAGS` に追記。Action と Query で同一定数を使うことで整合性を担保
- **型派生の慣習**: 入力は `Omit<T, 'id' | 'created_at' | 'updated_at'>`、部分更新は `Partial<*Input>`。CRUD ごとの型を新規定義しない
- **検証は段階的**: 軽量検証は Server Action 内、複雑な業務制約は Repository 実装側で。Mock と DB 実装の両方が同じ制約を満たすこと

---
_新規ファイルがこのパターンに従えば、本ファイルは更新不要。新たなレイヤー(例: `lib/db/`)を導入した時のみ追記する。_
