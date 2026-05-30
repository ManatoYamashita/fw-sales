# deep-research-pipeline: デプロイ Runbook (Issue #43)

Deep Research パイプラインの初期セットアップ + 以降の運用手順。
仕様詳細: `.kiro/specs/deep-research-pipeline/design.md`

> **CI 自動 migration**: PR merge 時に `drizzle/**` 変更があれば GitHub Actions
> (`migrate.yml`) が `pnpm db:migrate` を自動実行。手動 SQL 適用は不要。

---

## 初期セットアップ (済)

以下は初回デプロイ時に完了済み。 新規環境構築時のリファレンス。

### 1. GitHub Secrets

```bash
gh secret set CRON_SECRET    # openssl rand -hex 32 で生成した値
gh secret set VERCEL_URL      # https://fw-sales.vercel.app
gh secret set DATABASE_URL    # Supabase Session Pooler (port 5432) の接続文字列
```

> **注意**: `DATABASE_URL` は **Session Pooler (port 5432)** を使用すること。
> Transaction Pooler (port 6543) では drizzle-kit の prepared statement が失敗する。
> アプリ (Vercel) 側は Transaction Pooler のまま変更不要。

### 2. Vercel Env Vars

**Production / Preview / Development の 3 環境すべて** に以下を登録:

| 変数 | 必須 | 備考 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | 必須 | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 必須 | Supabase legacy anon key (JWT) |
| `SUPABASE_SERVICE_ROLE_KEY` | 必須 | |
| `DATABASE_URL` | 必須 | Transaction Pooler (port 6543) |
| `DATABASE_POOL_MAX` | 必須 | |
| `GEMINI_API_KEY` | 必須 | Google AI API キー |
| `GEMINI_MODEL` | 必須 | e.g. `gemini-2.5-flash` |
| `CRON_SECRET` | 必須 | GitHub Secrets と同一値 |
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

本番 (`https://fw-sales.vercel.app`) にログイン後:

### 調査キュー (/research)

1. サイドバー「調査キュー」がクリック可能、 in-flight 件数バッジ表示
2. 3 タブ: 実行中 / 完了 / 失敗
3. 実行中タブ: プログレスバー (3 ステップ) + 推定残り時間 + 最終更新時刻
4. 失敗タブ: 「再投入」ボタン

### 店舗詳細 (/stores/[id])

1. 「AI 分析」タブに Deep Research セクション
2. 「Deep Research を実行」ボタン → Toast + バッジ「キュー待ち」 + ボタン disabled
3. 所在地未入力店舗 → Toast「必須項目が未入力です: 所在地」で拒否

### エリア検索 (/stores/new?mode=area)

- 検索結果カードに「Deep Research を実行」CTA が **表示されない** こと (仕様)

---

## Rollback 手順

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
