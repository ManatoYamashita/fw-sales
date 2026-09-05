# deep-research-pipeline: デプロイ Runbook (Issue #43) 【廃止・履歴保存】

Deep Research パイプラインの初期セットアップ + 以降の運用手順。
仕様詳細: `.kiro/specs/deep-research-pipeline/design.md` (`spec.json` の `phase` は `removed`)

> **⚠ 2026-09-03 — 本 Runbook は全面廃止 (Issue #110)**
> #102 で運用を停止し、**コードも #116 / #125 / #180 / #185 / #213 / #110 で
> 物理削除済み**です (2026-06-03 時点の注記「コード自体は残置」は失効しました)。
> 以下に登場する GitHub Secrets (`CRON_SECRET` / `VERCEL_URL`)、`DEEP_RESEARCH_*`
> 系 env、`poll-research.yml`、`/api/cron/poll-research`、`research_jobs` /
> `research_reports` テーブル、貼付ワークベンチ導線は **いずれも現存しません**。
> セットアップ手順として実行しないでください。
>
> 現行の店舗調査は AI 店舗調査 (Plan v3.2 / Issue #180): `/research` から実行し
> 53 項目レビューで採否を決めます (`lib/ai/research/**` / `workflows/store-research.ts`)。
>
> **本ファイルで現行も有効な唯一の節**は「## 運用フロー > ### 新規 migration 追加時」
> (`pnpm db:generate` → `check-migrations.yml` → merge で `migrate.yml` 自動適用) です。

> **CI 自動 migration**: PR merge 時に `drizzle/**` 変更があれば GitHub Actions
> (`migrate.yml`) が `pnpm db:migrate` を自動実行。手動 SQL 適用は不要。

---

## 初期セットアップ (済)

以下は初回デプロイ時に完了済み。 新規環境構築時のリファレンス。

### 1. GitHub Secrets

> **【廃止】** **GitHub Secret の** `CRON_SECRET` / `VERCEL_URL` はコードからもワークフローからも
> 参照がゼロです (旧 `poll-research.yml` 専用だった)。削除して構いません。
> `DATABASE_URL` は `migrate.yml` / `supabase-keepalive.yml` が使用中のため**削除不可**。
>
> ⚠️ **同名の Vercel env var `CRON_SECRET` とは別物です。** そちらは 2026-09-05 に
> Supabase keepalive (Issue #242 / `/api/cron/keepalive`) 用として現役になりました。
> 消してよいのは GitHub Secret 側だけです。

```bash
gh secret set CRON_SECRET    # openssl rand -hex 32 で生成した値
gh secret set VERCEL_URL      # https://fw-sales.vercel.app
gh secret set DATABASE_URL    # Supabase Session Pooler (port 5432) の接続文字列
```

> **注意**: `DATABASE_URL` は **Session Pooler (port 5432)** を使用すること。
> Transaction Pooler (port 6543) では drizzle-kit の prepared statement が失敗する。
> アプリ (Vercel) 側は Transaction Pooler のまま変更不要。

### 2. Vercel Env Vars

> **【廃止】** 下表の `DEEP_RESEARCH_*` 系は現行コードに存在しません。
> 現行の必須 env は `.env.example` と `scripts/check-required-env.mjs` を参照。
>
> `CRON_SECRET` は **現役**です。ただし用途は本 spec の research ポーリングではなく、
> Supabase keepalive (Issue #242 / `/api/cron/keepalive`) に変わりました。
> 下表の「GitHub Secrets と同一値」という説明も過去のもので、現在は Vercel 側だけで
> 完結します (GitHub Actions からこの値を使う経路はありません)。

**Production / Preview / Development の 3 環境すべて** に以下を登録:

| 変数 | 必須 | 備考 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | 必須 | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 必須 | Supabase legacy anon key (JWT) |
| `SUPABASE_SERVICE_ROLE_KEY` | 必須 | |
| `DATABASE_URL` | 必須 | Transaction Pooler (port 6543) |
| `DATABASE_POOL_MAX` | 必須 | |
| `GEMINI_API_KEY` | 必須 | Google AI API キー |
| `GEMINI_MODEL` | 必須 | e.g. `gemini-3.6-flash` — 旧記載の `gemini-2.5-flash` は **2026-10-16 シャットダウン**のため設定例として使わないこと ([移行 runbook](./gemini-model-migration-runbook.md)) |
| `CRON_SECRET` | 必須 | Supabase keepalive cron の Bearer 認可 (#242)。3 環境すべてに登録 |
| `NEXT_PUBLIC_APP_URL` | 必須 | |
| `DEEP_RESEARCH_MODEL` | 任意 | default: `deep-research-preview-04-2026` |
| `DEEP_RESEARCH_STRUCTURER_MODEL` | 任意 | default: `gemini-2.5-flash-lite` |
| `DEEP_RESEARCH_MAX_IN_FLIGHT` | 任意 | default: `10` |
| `DEEP_RESEARCH_POLL_PER_TICK` | 任意 | default: `5` |
| `DEEP_RESEARCH_DAILY_USER_CAP` | 任意 | default: `30` |
| `DEEP_RESEARCH_MONTHLY_CAP` | 任意 | default: `1000` |
| `DEEP_RESEARCH_MONTHLY_WARNING_PERCENT` | 任意 | default: `80` |
| `DEEP_RESEARCH_STALL_THRESHOLD_MIN` | 任意 | default: `90` (分)。`researching` のまま `api_updated_at` がこの時間以上凍結したら停滞 sweep。大きくすると stall 検知を即時無効化 (再デプロイ不要) |
| `DEEP_RESEARCH_STALL_GRACE_MIN` | 任意 | default: `60` (分)。`research_started_at` がこの時間以上前のジョブのみ stall 検知対象 (起動直後の誤検知防止) |

> **進捗停滞 (stall) 検知**: cron tick の Stage A2 が「`researching` のまま Google 側
> `api_updated_at` が `DEEP_RESEARCH_STALL_THRESHOLD_MIN` 以上更新されない」ジョブを 6h
> 待たず `failed` 化する (`error_log.kind = "stage1_stalled_no_progress"`)。tick レスポンス
> JSON の `stalled_swept` 件数で監視可能。6h 経過軸の `swept` とは別計上 (停滞頻発=Google
> 側問題、6h スタック頻発=cron 遅延、と切り分けられる)。誤検知が出たら閾値 env を大きくする
> だけで即時無効化できる (コード revert 不要)。

> **Vercel CLI バグ**: `vercel env add <name> preview` は `git_branch_required` で
> 失敗する (v54.4.1 時点)。 REST API 経由でバルク追加が確実。

### 3. DB マイグレーション

> **【履歴】** 0008 / 0009 が作成したテーブルは 0017 で DROP 済みです。

**CI が自動適用** (`migrate.yml`)。 `drizzle/**` 変更を含む PR を main にマージ
するだけで `pnpm db:migrate` が実行される。

手動適用が必要な場合 (初回セットアップ等):
```bash
pnpm db:migrate  # DATABASE_URL が .env.local に設定済みであること
```

適用済み migration:
- `0008_add_deep_research.sql` — `research_jobs` + `research_reports` テーブル
- `0009_add_api_updated_at.sql` — `research_jobs.api_updated_at` 列

---

## 運用フロー

### 新規 migration 追加時

1. `lib/db/schema.ts` を編集
2. `pnpm db:generate` で SQL + journal 生成
3. PR 作成 → `check-migrations.yml` が整合性チェック
4. PR merge → `migrate.yml` が自動適用
5. Vercel auto-deploy (migration 適用後にアプリコードが反映)

### GitHub Actions cron

> **【廃止】** `poll-research.yml` は #125 で削除済みです。以下のコマンドは実行できません。

`poll-research.yml` が 30 分間隔 (`*/30 * * * *`) で Vercel の
`/api/cron/poll-research` を呼び出す。

```bash
# 疎通確認
gh workflow run "Poll Deep Research Jobs"
gh run list --workflow=poll-research.yml --limit 1

# 停止 (障害時)
gh workflow disable "Poll Deep Research Jobs"

# 再開
gh workflow enable "Poll Deep Research Jobs"
```

---

## E2E 動作確認

> **【廃止】** 貼付ワークベンチと店舗詳細の Deep Research セクションは #180 / #125 で
> 撤去済みです。現行の E2E 手順は AI 店舗調査フローに読み替えてください。

本番 (`https://fw-sales.vercel.app`) にログイン後:

### 調査 (/research)

1. サイドバー「調査」がクリック可能
2. 2 タブ: 調査待ち / 調査済み (各タブに件数表示)
3. 調査待ちタブ: 店舗行の「調査開始」から貼付ワークベンチ (`/research/[storeId]`) へ遷移し、Gemini の DeepResearch 結果 Markdown を貼り付けて構造化・架電生成
4. 調査済みタブ: 構造化・架電生成を終えた店舗が stage バッジ付きで一覧表示

### 店舗詳細 (/stores/[id])

1. 「AI 分析」タブ末尾に Deep Research セクション（8 カテゴリ・51 項目）
2. 自動キュー投入ボタンは #102 で撤去済み。レポートなし → 「結果を貼り付ける」、レポートあり → 「貼付ワークベンチを開く」で `/research/[storeId]` へ遷移
3. 店舗登録は店舗名のみ必須（所在地等は任意）。店舗名が空なら「店舗名を入力してください」で拒否

### エリア検索 (/stores/new?mode=area)

- 自動キュー投入 (enqueue) は #102 で全廃済みのため、エリア検索を含め全画面で「Deep Research を実行」CTA は存在しない

---

## Rollback 手順

> **【廃止】** `research_jobs` / `research_reports` は
> `drizzle/0017_remove_deep_research_tables.sql` で DROP 済みです。

```bash
# 1. cron 停止 (最速の blast 制御)
gh workflow disable "Poll Deep Research Jobs"

# 2. 進行中ジョブを失敗扱い
psql "$DATABASE_URL" <<EOF
UPDATE research_jobs
SET status = 'failed',
    completed_at = NOW(),
    error_log = COALESCE(error_log, '[]'::jsonb) || '[{"stage":"sweep","kind":"manual_rollback","message":"manual rollback","occurred_at":"$(date -u +%Y-%m-%dT%H:%M:%SZ)"}]'::jsonb
WHERE status IN ('queued', 'researching', 'structuring');
EOF

# 3. (最終手段) main revert
git revert <commit-hash> && git push origin main
```

DB テーブル (`research_jobs` / `research_reports`) は新規追加のみで既存テーブルへの
変更ゼロのため、 DROP しても他機能には影響しない。
