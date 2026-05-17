# FirstWeb - Reserch AI for Sales（新卒グルメ）

<img width="500" height="auto" alt="firstweb-loados" src="https://github.com/user-attachments/assets/c7dedfb1-607a-4675-a183-0f7332523b8c" />

飲食店向け WEB 集客の営業管理システム(社内ツール)を **Next.js 16 (App Router) + React 19 + TypeScript strict + Tailwind CSS v4** で再構築したものです。

## 主な特徴

- **App Router + Cache Components** (`'use cache'` / `cacheTag` / `cacheLife`)
- **Server Actions** によるミューテーション。`revalidateTag(tag, "max")` で stale-while-revalidate
- **Supabase Postgres + Drizzle ORM** による永続化(`lib/db/*`)
- **Repository インターフェース**(`lib/repositories/*-repository.ts`)で永続化層を抽象化
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

店舗 (Store) / 商談 (Deal) / 調査 (Research) / 引き継ぎ (Handoff) の 4 entity を Supabase Postgres + Drizzle ORM で永続化する手順です。`DATABASE_URL` は起動必須(未設定だと `lib/db/client.ts` が fail-fast)。

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
| `DATABASE_URL` | 必須 | Supabase Postgres 接続文字列 (Transaction pooler 推奨)。未設定だと `lib/db/client.ts` が fail-fast で `process.exit(1)` する |
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

`SEED_STORES` / `SEED_DEALS` / `SEED_RESEARCH` / `SEED_HANDOFFS` (`lib/db/seed-data.ts`) の 4 entity データを Postgres に upsert します。FK 整合のため `stores → deals → research → handoffs` の順で投入され、`ON CONFLICT DO UPDATE` でベキ等です。

```bash
pnpm seed
```

内部的に `NODE_OPTIONS='--conditions=react-server' tsx scripts/seed.ts` を実行します(`server-only` パッケージを `react-server` condition で `empty.js` に解決させ、CLI 単体実行を可能にするため)。

担当者紐付け (`assigned_planner_user_id` / `assigned_sales_user_id`) は seed-data 内で全て null です。実運用で担当者を割り当てたい場合は、Supabase Auth で作成した実ユーザーの UUID で別途 UPDATE してください。

### 6. 開発サーバー起動

```bash
pnpm dev          # DATABASE_URL 必須
```

起動時に `lib/db/client.ts` が `select 1` で接続ヘルスチェックを行い、失敗時は `process.exit(1)` で fail-fast します。

### 検証コマンド

```bash
pnpm typecheck && pnpm lint && pnpm build
```

動作確認は次の E2E が標準手順です(詳細は `.kiro/specs/deals-stores-db-migration/requirements.md` §11):

1. `/stores/{storeId}` で新規商談を作成し「受注」で保存
2. プロセスを再起動
3. `/deals` に商談が残存していることを確認
4. `/stores/{storeId}` で店舗 stage が「受注」に同期されていることを確認
5. `/dashboard` / `/kpi` / `/pipeline` で受注金額・件数の集計反映を確認

## Authentication & Notifications (#16)

> **2026-05-17 更新**: 商談リマインダー (Vercel Cron + Resend メール通知) と Resend 関連実装一式を削除しました。詳細は本セクション末尾の取り消し線付き履歴を参照。Supabase Auth (Google OAuth) 部分は引き続き稼働します。

本リポジトリは Supabase Auth (Google OAuth) を統合した認証基盤を持ちます。詳細仕様は `.kiro/specs/auth-and-notifications/` 参照(メール通知部分は削除済)。

### 自由登録のリスク (運用注意)

Supabase 側の Google OAuth プロバイダーで **誰でもサインイン可能** な状態のため、内部ツールとして使う場合は **以下の運用統制が必須**:

- Supabase Project Settings > Authentication > Providers > Google で `Authorized client IDs` / `Authorized email domains` を設定し、社内ドメインのみ許可する
- もしくは Vercel / Supabase Edge Function 側で email allowlist を実装する(将来 Issue 予定)
- placeholder profile (`role='placeholder'` / `email='placeholder-*@local.invalid'`) は Backfill 時に旧 text 担当者値を引き継いだ仮レコード。実ユーザーが対応する場合は Admin UI でマージする運用(将来 Issue)

### 環境変数 (5 件)

| 変数 | 用途 | 未設定時の挙動 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase プロジェクト URL | サインイン失敗 (`/login` で OAuth 起動不可) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon 公開キー | 同上 |
| `SUPABASE_SERVICE_ROLE_KEY` | (将来用) Service Role キー | 現状未使用 |
| `GOOGLE_OAUTH_CLIENT_ID` | Supabase Provider 側で設定する Google OAuth Client ID | Supabase 側設定がなければサインイン失敗 |
| `GOOGLE_OAUTH_CLIENT_SECRET` | 同上 Secret | 同上 |

### ~~Vercel Cron (商談リマインダー)~~ — 削除済 (2026-05-17)

> 以下は履歴参照用。`vercel.json` の `crons` セクション、`/api/cron/deal-reminders` route、`lib/email/*` 一式、`RESEND_API_KEY` / `RESEND_FROM_EMAIL` / `CRON_SECRET` env、`resend` npm 依存はすべて削除済。再導入時は本コミットの revert と spec 復活が起点。

~~`vercel.json` で 2 つの Cron を登録済:~~

- ~~`/api/cron/deal-reminders?mode=tomorrow` → 毎日 UTC 22:00 (JST 07:00) — 翌日商談リマインダー~~
- ~~`/api/cron/deal-reminders?mode=today` → 毎日 UTC 23:00 (JST 08:00) — 当日商談リマインダー~~

~~ローカルで疑似発火する場合:~~

~~`curl -H "Authorization: Bearer ${CRON_SECRET}" 'http://localhost:3000/api/cron/deal-reminders?mode=tomorrow'`~~

~~`CRON_SECRET` 未設定だと 401、`RESEND_API_KEY` 未設定だと送信は no-op (`skipped` カウントに記録) で 200 が返ります。~~

## 初回ローカル開発セットアップ (TL;DR)

新規メンバー / 別マシンでの開発再開向けチェックリスト。詳細は本 README の各章を参照。

1. **依存インストール**: `pnpm install`
2. **環境変数設定**: `.env.example` を参考に `.env.local` を作成し、以下を埋める
   - `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` (Supabase Dashboard → Project Settings → API → Legacy anon/service_role)
   - `DATABASE_URL` (Supabase Dashboard → Project Settings → Database → Connection string (Transaction pooler))
3. **Supabase Dashboard 設定** (初回のみ):
   - Authentication → URL Configuration → Site URL: `http://localhost:3000` / Redirect URLs: `http://localhost:3000/**`
   - Authentication → Providers → Google を Enable + Google Cloud Console で OAuth 2.0 Client (Web) を作成し Authorized redirect URIs に `https://<project-ref>.supabase.co/auth/v1/callback` を登録 → Client ID/Secret を Supabase の Google Provider 設定に貼り付け
4. **DB マイグレーション適用**: `pnpm db:migrate` (#27 で導入された short-cut、`.env.local` を自動読込)
5. (任意) **シード投入**: `pnpm seed`
6. **開発サーバ起動**: `pnpm dev`
7. **動作確認**: http://localhost:3000/login → Google でサインイン → `/stores` に着地、ヘッダーにアバター + 表示名

> #28 で `0007_backfill_existing_auth_users.sql` が追加され、ステップ 4 で既存 `auth.users` の profiles row が自動的に揃います(以前必要だった手動 SQL 実行は不要)。

## トラブルシューティング

| 症状 | 原因 | 対応 |
|---|---|---|
| `Supabase environment variables are not set. Sign-in is unavailable.` | `.env.local` の Supabase 3 変数が未設定 | 「初回セットアップ」ステップ 2 を確認 |
| `/login` で blocking-route エラー (`Runtime data such as cookies()/searchParams was accessed outside of <Suspense>`) | Next.js 16 で page 関数本体が dynamic API を await している | 動的 access を Suspense 境界内の async 子 component に分離 (`app/login/page.tsx:65` 参照) |
| `/dashboard` で `Failed query: select ... from "profiles" where id = $1` | `profiles` テーブル不在、または既存 `auth.users` user に対応する row 不在 | ステップ 4 (`pnpm db:migrate`) を実行 — #28 で 0007 が backfill 自動化済 |
| Google サインイン後 `/login?error=oauth_failed` | Google Cloud Console の Authorized redirect URIs に Supabase callback (`https://<ref>.supabase.co/auth/v1/callback`) 未登録、または Google Provider に Client Secret 未設定 | ステップ 3 の Google Provider 設定を再確認 |
| `pnpm typecheck` / `pnpm build` が `Cannot find module .next/types/.../route.js` で失敗 | 別ブランチで新規追加されたファイル参照が `.next/types/` キャッシュに残っている | `rm -rf .next` してから再実行 |

> Next.js 16 はこのプロジェクトのトレーニングデータと異なる挙動が多い (`AGENTS.md` 冒頭参照)。実装前に `node_modules/next/dist/docs/` の該当ガイドを必ず確認すること。

## 既存資産の扱い

- 旧来のバニラJS実装は `legacy/vanilla-js` ブランチと `v0-legacy` タグで保全
- 復元したい場合: `git checkout v0-legacy`
