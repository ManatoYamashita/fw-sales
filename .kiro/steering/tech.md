# Technology Stack

## Architecture

**Next.js App Router + Cache Components** ベースの RSC ファースト構成。データ取得は Server Component / `'use cache'` 関数で行い、変更系は Server Actions に集約。データアクセスは Repository パターンで抽象化されており、現状は Mock 実装(インメモリ Map + globalThis 永続化)が差し込まれている。

## Core Technologies

- **Language**: TypeScript 5+ (strict + `noUncheckedIndexedAccess`)
- **Framework**: Next.js 16.3.1 (App Router, `cacheComponents: true`)
- **UI Runtime**: React 19.2.4 (Server Components + Server Actions)
- **Styling**: Tailwind CSS v4 (`@theme` トークン、cossUI 由来の neutral-first OKLCH パレット)
- **Package Manager**: pnpm (workspace 構成)

> **重要**: Next.js 16 / React 19 はトレーニングデータと差異がある。新規実装前に `node_modules/next/dist/docs/` の該当ガイドを必ず参照する(AGENTS.md / CLAUDE.md の指示)。

## Key Libraries

- **`@base-ui/react`**: アクセシブルな UI プリミティブ(Modal, Tabs 等の土台)
- **`class-variance-authority` + `clsx`**: バリアント駆動のスタイル定義
- **`lucide-react`**: アイコン
- **`next-themes`**: ライト / ダーク / システムのテーマ切替
- **追加ライブラリは原則禁止**: 新規依存の追加は必要性を明示し、合意を得てから

## Development Standards

### Type Safety
- TypeScript `strict: true` + `noUncheckedIndexedAccess: true`
- `any` 禁止。型は `types/` 以下に集約し、`*Input` / `*Patch` 派生型は `Omit` / `Partial` で派生
- ステージ・チャネル等の列挙は `as const` 配列 + `(typeof X)[number]` でリテラル型化

### Server / Client 境界
- サーバーのみのモジュールは先頭で `import "server-only"` を宣言
- Server Actions ファイルは先頭で `"use server"`
- Client Component は先頭で `"use client"`、原則 `components/layout` と `components/ui` の対話系のみ

### Code Quality
- ESLint: `next/core-web-vitals` + `eslint-config-next/typescript`
- フォーマッタは ESLint 経由(専用 Prettier 設定なし)

### Testing
- 自動テストフレームワーク未導入。検証は `pnpm typecheck` / `pnpm lint` / `pnpm build` + ブラウザ動作確認

## Development Environment

### Common Commands
```bash
pnpm install
pnpm dev          # http://localhost:3000 (Turbopack)
pnpm typecheck    # tsc --noEmit
pnpm lint         # ESLint
pnpm build
```

## Key Technical Decisions

### Repository Pattern による DB 抽象化
- `lib/repositories/*-repository.ts` に interface、`lib/mock/*` に Mock 実装
- `lib/repositories/index.ts` の `repos` オブジェクトが唯一の差し替え点
- DB 化(Drizzle + Supabase 想定)時は Server Actions / Queries を無修正で切替可能

### Cache Components 戦略
- 取得系は `'use cache'` 関数(`lib/queries/*`)で包み、`cacheTag(CACHE_TAGS.x)` でタグ付与
- 変更系は Server Action 内で `revalidateTag(tag, "max")` を呼び stale-while-revalidate
- タグキーは `lib/cache.ts` の `CACHE_TAGS` 定数に集約 (single source of truth)

### Server Actions の規約
- `lib/actions/_helpers.ts` の `ActionResult<T>` 型 + `success` / `failure` ヘルパで戻り値を統一
- FormData 取り扱いは `readString` / `readNumber` / `readNullableNumber` / `readBool` を経由

### Composition Pattern
- Card / Modal / Tabs などは Compound Components(`<Card.Header />` のようなドット記法)
- RSC ↔ Client Component の橋渡しは props ではなく `children` で行う

### デザインシステム
- cossUI 由来のトークンのみ採用(MIT ライセンス範囲)。AGPL の `@coss/ui` 本体ソースは取り込まない
- カラーは `app/globals.css` の `@theme` で OKLCH 定義、Stage 配色は `[data-stage="<id>"]` セレクタ
- Button 等のバリアントは `cva` で表現

---
_詳細な依存リストではなく、新規コードの判断基準となる方針を記述。新ライブラリ追加時はこの文書を更新する。_
