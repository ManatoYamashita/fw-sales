# Firstweb Lead OS — Next.js 16

飲食店向け WEB 集客の営業管理システム(社内ツール)を **Next.js 16 (App Router) + React 19 + TypeScript strict + Tailwind CSS v4** で再構築したものです。

## 主な特徴

- **App Router + Cache Components** (`'use cache'` / `cacheTag` / `cacheLife`)
- **Server Actions** によるミューテーション。`revalidateTag(tag, "max")` で stale-while-revalidate
- **mock データ層** (server-only インメモリ Map + globalThis 永続化)
- 後で DB へ差し替えるための **Repository インターフェース**(`lib/repositories/*-repository.ts`)
- **Composition Pattern**: Card / Modal / Tabs は Compound Components、RSC ↔ Client は children で橋渡し
- **cossUI 由来のデザインシステム**(MIT 範囲のトークンのみ採用、AGPL の `@coss/ui` ソースは未取り込み)
- **ダークモード対応**(`next-themes`、Settings 画面でライト / ダーク / システム切替)
- 主要追加依存: `lucide-react`, `clsx`, `class-variance-authority`, `next-themes`, `@base-ui/react`

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

## デザインシステム

- **トークン体系**(`app/globals.css`): cossUI 流の neutral-first OKLCH カラーパレット ─ `--background` / `--foreground` / `--card` / `--muted` / `--primary` / `--info` / `--success` / `--warning` / `--destructive` / `--sidebar-*` / `--chart-1〜5`
- **タイポグラフィ**: `<Heading level={1|2|3|4} />` / `<Display />` / `<Text variant="..." />`(`components/ui/typography.tsx`)
- **Stage 配色**: `[data-stage="<id>"]` セレクタで `--stage` / `--stage-foreground` を切替(12 ステージ × Light / Dark)
- **Button**: cva ベース(variant: default / secondary / ghost / outline / link / destructive ほか × size: sm / md / lg / xl / icon-*)
- **Theme Toggle**: `components/ui/theme-toggle.tsx`(Topbar)+ Settings 画面の `ThemeToggleCard`(ラジオ風)

## キャッシュ設計

- マスタ/集計データは **`'use cache'` 関数**でラップし、`cacheTag` を付与
- 各 Server Action は変更後に `revalidateTag(tag, "max")` を呼ぶ(stale-while-revalidate)
- 主要タグは `lib/cache.ts` に集約(`stores`, `store:{id}`, `deals`, `handoffs`, `stats`, `kpi`, `pipeline`, `actionQueue` など)

## DB セットアップ手順 (Supabase + Drizzle)

店舗 (Store) / 商談 (Deal) / 調査 (Research) / 引き継ぎ (Handoff) の 4 entity を Supabase Postgres + Drizzle ORM で永続化する手順です。Mock のみで動作確認したい場合は最後の「Mock モード切替」を参照してください。

### 1. Supabase プロジェクト作成

1. [Supabase Console](https://supabase.com/dashboard) にログインし、新規プロジェクトを作成(Region は近接リージョン推奨)
2. 作成完了後、`Project Settings` → `API` から `Project URL` を控える
3. 同画面の `Service Role Key` を控える(本リポジトリは Service Role Key で Postgres へ直接接続する構成。クライアントへ晒さないこと)

参考: [Supabase Docs — Connecting to Postgres](https://supabase.com/docs/guides/database/connecting-to-postgres)

### 2. 接続文字列 (DATABASE_URL) の取得

Supabase Dashboard → `Project Settings` → `Database` → `Connection string` セクションを開き、**Transaction pooler** (port `6543`) の接続文字列をコピーします。`postgres.js` の `prepare: false` 設定 (`lib/db/client.ts`) は Transaction Pooler 互換のため既に有効化されています。

```text
postgres://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres?sslmode=require
```

### 3. `.env.local` の作成

```bash
cp .env.example .env.local
# エディタで .env.local を開き、DATABASE_URL に手順 2 で取得した接続文字列を貼り付ける
```

主な環境変数:

| キー | 必須 | 用途 |
|---|---|---|
| `DATABASE_URL` | DB モード時必須 | Supabase Postgres 接続文字列 (Transaction pooler 推奨) |
| `USE_MOCK_DB` | 任意 | `true` で Mock モード起動。未設定なら DB モード |
| `DATABASE_POOL_MAX` | 任意 | `postgres.js` のコネクションプール最大数。既定 `10` |

#### `DATABASE_POOL_MAX` の選び方

| 配備形態 | 推奨値 | 理由 |
|---|---|---|
| Self-host (Node 長期プロセス, Docker, VPS 等) | `10` | プロセス内で複数接続を保持し再利用 |
| Vercel / serverless / Edge-adjacent | `1` | 各実行環境で 1 接続に絞り、Supabase Pooler 側で多重化。`10` のままだと `too many connections` を誘発 |

### 4. マイグレーションの適用

`drizzle/` 配下の SQL を Supabase に適用します。

```bash
pnpm drizzle-kit migrate          # drizzle/*.sql を順次適用 (推奨)
# あるいは開発初期のスキーマ調整中は push を併用
pnpm drizzle-kit push             # スキーマ差分を直接反映 (本番運用では migrate を使用)
```

複数の `drizzle/000N_*.sql` がある場合は番号順に適用されます (`0000` → `0001` → `0002` ...)。スキーマ定義 (`lib/db/schema.ts`) を変更した場合は `pnpm drizzle-kit generate` で SQL を再生成してから `migrate` を実行してください。

参考: [Drizzle Kit Migrations](https://orm.drizzle.team/docs/kit-overview)

### 5. SEED データの投入

`SEED_STORES` / `SEED_DEALS` / `SEED_RESEARCH` / `SEED_HANDOFFS` (`lib/mock/seed.ts`) と同等の 4 entity データを Postgres に upsert します。FK 整合のため `stores → deals → research → handoffs` の順で投入され、`ON CONFLICT DO UPDATE` でベキ等です。

```bash
pnpm seed
```

内部的に `NODE_OPTIONS='--conditions=react-server' tsx scripts/seed.ts` を実行します(`server-only` パッケージを `react-server` condition で `empty.js` に解決させ、CLI 単体実行を可能にするため)。

`USE_MOCK_DB=true` が設定されている環境ではスクリプトは警告のみ出してスキップします(誤実行防止)。

### 6. 開発サーバー起動

```bash
pnpm dev          # DB モード (DATABASE_URL 必須)
```

起動時に `lib/db/client.ts` が `select 1` で接続ヘルスチェックを行い、失敗時は `process.exit(1)` で fail-fast します。

### Mock モード切替

外部 DB 接続なしで開発・E2E を行う場合は環境変数で Mock モードに切り替えられます。

```bash
USE_MOCK_DB=true pnpm dev
```

このモードでは `lib/db/*` は一切評価されず、`DATABASE_URL` 未設定でも起動できます。インメモリ Map + `globalThis` 永続化による従来 Mock 実装が選択されます。

### 検証コマンド

```bash
pnpm typecheck && pnpm lint && pnpm build
```

DB モードでの動作確認は次の E2E が標準手順です(詳細は `.kiro/specs/deals-stores-db-migration/requirements.md` §11):

1. `/stores/{storeId}` で新規商談を作成し「受注」で保存
2. プロセスを再起動
3. `/deals` に商談が残存していることを確認
4. `/stores/{storeId}` で店舗 stage が「受注」に同期されていることを確認
5. `/dashboard` / `/kpi` / `/pipeline` で受注金額・件数の集計反映を確認

## 既存資産の扱い

- 旧来のバニラJS実装は `legacy/vanilla-js` ブランチと `v0-legacy` タグで保全
- 復元したい場合: `git checkout v0-legacy`
