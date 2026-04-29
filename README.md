# Firstweb Lead OS — Next.js 16

飲食店向け WEB 集客の営業管理システム(社内ツール)を **Next.js 16 (App Router) + React 19 + TypeScript strict + Tailwind CSS v4** で再構築したものです。

## 主な特徴

- **App Router + Cache Components** (`'use cache'` / `cacheTag` / `cacheLife`)
- **Server Actions** によるミューテーション。`revalidateTag(tag, "max")` で stale-while-revalidate
- **mock データ層** (server-only インメモリ Map + globalThis 永続化)
- 後で DB へ差し替えるための **Repository インターフェース**(`lib/repositories/*-repository.ts`)
- **Composition Pattern**: Card / Modal / Tabs は Compound Components、RSC ↔ Client は children で橋渡し
- 過剰依存ゼロ: 追加した npm パッケージは `lucide-react` と `clsx` のみ

## 開発

```bash
pnpm install
pnpm dev          # http://localhost:3000 (Turbopack)
pnpm typecheck    # tsc --noEmit (strict + noUncheckedIndexedAccess)
pnpm lint         # ESLint (next/core-web-vitals + typescript-eslint)
pnpm build
```

## ディレクトリ構造(抜粋)

```
app/
├── layout.tsx                 # html/body, fonts (Inter + Noto Sans JP), <Toaster />
├── globals.css                # Tailwind v4 + @theme トークン
├── page.tsx                   # / → /dashboard へ redirect
├── (main)/                    # 共通シェル(サイドバー + トップバー)
│   ├── layout.tsx
│   ├── dashboard/             # KPI / アクションキュー / パイプラインサマリー
│   ├── stores/                # 一覧・登録・詳細・編集
│   ├── research/              # 調査キュー・記録
│   ├── pipeline/              # Kanban
│   ├── actions/               # DM/Tel スクリプト + 実行記録
│   ├── deals/                 # 商談一覧・新規・詳細
│   ├── handoffs/              # 引き継ぎ管理
│   ├── kpi/                   # ファネル / 変換率 / チャネル内訳
│   └── settings/              # データ概要 / Export / Import / Reset
└── api/
    └── export/route.ts        # JSON ダウンロード

components/
├── ui/                        # Button / Badge / Card / Modal / Tabs / Toast …
├── feature/                   # ドメインバッジ(Stage / Channel / Priority …)
└── layout/                    # Sidebar (Client) / Topbar (Client) / NavBadges (RSC)

lib/
├── domain/                    # STAGES, SERVICES, STAFF, channel 判定
├── repositories/              # 抽象 interface (差し替え対象の入口)
├── mock/                      # インメモリ実装 + シードデータ
├── queries/                   # 集計 / 取得関数 ('use cache' で包む)
├── actions/                   # Server Actions ('use server')
├── url-parser/                # 食べログ / Googleマップ URL 解析 + OGP fetch
├── templates/                 # DM / テレアポ文面生成(純関数)
├── utils/                     # date / format / id / cn(clsx)
└── cache.ts                   # CACHE_TAGS 定数

types/                         # Store / Research / Deal / Handoff / Stage
```

## キャッシュ設計

- マスタ/集計データは **`'use cache'` 関数**でラップし、`cacheTag` を付与
- 各 Server Action は変更後に `revalidateTag(tag, "max")` を呼ぶ(stale-while-revalidate)
- 主要タグは `lib/cache.ts` に集約(`stores`, `store:{id}`, `deals`, `handoffs`, `stats`, `kpi`, `pipeline`, `actionQueue` など)

## DB に置き換える際の手順

1. `lib/db/store-repository.ts` 等を新設(Drizzle / Prisma など)
2. `lib/repositories/index.ts` の `repos.store = mockStoreRepo` を新実装に差し替える
3. Server Action とクエリは無修正で動作

## 既存資産の扱い

- 旧来のバニラJS実装は `legacy/vanilla-js` ブランチと `v0-legacy` タグで保全
- 復元したい場合: `git checkout v0-legacy`
