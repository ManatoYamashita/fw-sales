# deep-research-pipeline: デプロイ Runbook (Issue #43)

PR #54 を本番に出すまでの **3 サービス × 2 経路 (Claude in Chrome / CLI)** 手順書。
仕様詳細: `.kiro/specs/deep-research-pipeline/design.md` §Migration Strategy。

> **重要前提**: マイグレーション適用はすべて **手動コマンド** で行う (本リポジトリは
> Vercel deploy hook に DB migrate を組み込んでいない、既存規約に準拠)。

---

## 全体フロー

```
1. CRON_SECRET 生成 (ローカル CLI)
2. GitHub Secrets 登録          ┐ どちらが先でも良い
3. Vercel Env Vars 登録         ┘
4. DB マイグレーション 0008 適用
5. PR #54 をマージ → Vercel auto-deploy
6. GitHub Actions workflow_dispatch で疎通確認
7. 店舗詳細画面で E2E 動作確認
8. (任意) Phase 0 PoC 実機検証
```

---

## Step 1. CRON_SECRET 生成 (ローカル CLI 必須)

ブラウザ任せにすると履歴に残るリスクがあるため、必ずローカルターミナルで生成。

```bash
openssl rand -hex 32
# 例: 4b8e3f9a1c2d5e7b... (64 文字の hex)
```

生成値はパスワードマネージャー等に保管。**Step 2 と Step 3 で同一値**を使用。

---

## Step 2. GitHub Secrets 登録

### 経路 A: Claude in Chrome に依頼

GitHub の Repository Settings → Secrets and variables → Actions を開いてから、以下のプロンプトを Claude in Chrome に送信:

```
このページ (GitHub Actions Secrets) で、リポジトリ "ManatoYamashita/fw-sales" に
以下 2 件の Repository secret を登録してください。

1. Name: CRON_SECRET
   Value: <ここにユーザーが Step 1 で生成した hex 64 文字を貼り付け>

2. Name: VERCEL_URL
   Value: https://<本番デプロイメントの URL、例: fw-sales.vercel.app>

「New repository secret」ボタンから 1 つずつ登録し、登録後に Secrets 一覧に
"CRON_SECRET" と "VERCEL_URL" が表示されることを確認してください。値は表示
されない (GitHub の仕様) ので、登録後の確認は名前のみで OK です。
```

### 経路 B: gh CLI で完結

```bash
gh secret set CRON_SECRET --body "<Step 1 で生成した hex 64 文字>"
gh secret set VERCEL_URL --body "https://<本番デプロイメント URL>"
gh secret list  # 2 件登録されたか確認
```

---

## Step 3. Vercel Env Vars 登録

### 経路 A: Claude in Chrome に依頼

Vercel Dashboard → Project (fw-sales) → Settings → Environment Variables を
開いてから、以下のプロンプトを Claude in Chrome に送信:

```
このページ (Vercel Project Environment Variables) で、以下の環境変数を登録して
ください。Production / Preview / Development の 3 環境すべてに反映する設定で
お願いします。

必須:
- Name: CRON_SECRET
  Value: <ここにユーザーが Step 1 で生成した hex 64 文字を貼り付け>
  Environments: Production, Preview, Development (3 つ全部)

任意 (運用調整用、未設定なら default 値が適用される):
- Name: DEEP_RESEARCH_MODEL                Value: deep-research-preview-04-2026
- Name: DEEP_RESEARCH_STRUCTURER_MODEL     Value: gemini-2.5-flash-lite
- Name: DEEP_RESEARCH_MAX_IN_FLIGHT        Value: 10
- Name: DEEP_RESEARCH_POLL_PER_TICK        Value: 5
- Name: DEEP_RESEARCH_DAILY_USER_CAP       Value: 30
- Name: DEEP_RESEARCH_MONTHLY_CAP          Value: 1000
- Name: DEEP_RESEARCH_MONTHLY_WARNING_PERCENT  Value: 80

登録後、Environment Variables 一覧画面に上記の名前が並ぶことを確認して
ください。値は伏字で表示されます。

最後に、設定反映のため Deployments タブから最新の本番デプロイを
"Redeploy" してください (Vercel は env 更新だけでは再ビルドしないため)。
```

### 経路 B: vercel CLI で完結

```bash
vercel env add CRON_SECRET production preview development
# プロンプトに hex 値を入力

# 任意の運用設定 (default で問題なければ skip 可)
vercel env add DEEP_RESEARCH_MAX_IN_FLIGHT production preview development
# 10 を入力 ... 以下同様
```

登録後は本番再デプロイ:

```bash
vercel --prod  # または vercel deploy --prod
```

---

## Step 4. DB マイグレーション 0008 適用

### 経路 A: Claude in Chrome に依頼

Supabase Dashboard → Project → SQL Editor を開いてから、以下のプロンプトを
Claude in Chrome に送信:

```
このページ (Supabase SQL Editor) で、以下の SQL を実行してください。
deep-research-pipeline 機能で必要な 2 テーブル (research_jobs / research_reports)
と外部キー・インデックスを追加します。

実行前に、必ず以下を確認してください:
1. 現在接続中の Project が本番 (Production) であること
2. SQL 全文に DROP / TRUNCATE / DELETE などの破壊的命令が含まれないこと
   (CREATE TABLE / CREATE INDEX / ALTER TABLE ADD CONSTRAINT のみ)

確認できたら SQL Editor に貼り付けて "Run" を実行してください。
完了後、Table Editor で research_jobs と research_reports の 2 テーブルが
作成されたことを確認してください。

SQL の中身:
[GitHub の drizzle/0008_add_deep_research.sql から全文コピーして貼り付け]
URL: https://github.com/ManatoYamashita/fw-sales/blob/feat/deep-research-pipeline-43/drizzle/0008_add_deep_research.sql
```

> **重要**: Claude in Chrome に SQL 内容を直接プロンプトで渡すと、長文化と
> 履歴漏洩リスクが上がります。GitHub の生 SQL を Claude in Chrome に開かせ、
> "コピーして SQL Editor に貼って実行" の流れがベスト。

### 経路 B: Drizzle CLI で完結 (推奨)

```bash
# .env.local の DATABASE_URL が本番を指していることを必ず確認
cat .env.local | grep DATABASE_URL  # postgres://...supabase.co のはず

# dry-run で確認 (現在の DB と schema の差分表示)
pnpm db:check

# 適用
pnpm db:migrate

# 適用後の確認 (psql で本番に直接接続)
psql "$DATABASE_URL" -c "\d research_jobs"
psql "$DATABASE_URL" -c "\d research_reports"
```

---

## Step 5. PR #54 をマージ → Vercel auto-deploy

GitHub UI または `gh pr merge 54 --squash` でマージ。Vercel は main への push を
検出して自動デプロイ。デプロイ完了 (約 2-3 分) まで待機。

```bash
gh pr merge 54 --squash --delete-branch
gh run watch  # 直近 workflow の完了監視 (任意)
```

---

## Step 6. GitHub Actions workflow_dispatch で疎通確認

### 経路 A: Claude in Chrome に依頼

GitHub Actions → "Poll Deep Research Jobs" を開いてから、以下のプロンプトを
Claude in Chrome に送信:

```
このページで "Run workflow" ボタンを押し、main ブランチで手動実行してください。
実行完了後、最新の run をクリックし、"poll" ジョブのログ末尾を確認してください。

期待:
- HTTP 200 が表示されること
- レスポンス JSON に { "swept": <数値>, "polled": <数値>, "completed": <数値>,
  "started": <数値>, "deadline_reached": <true/false> } の 5 フィールドが含まれること
- ジョブ全体が ✓ (緑) で完了すること

もし HTTP 401 / 503 / 500 が返ったら、以下を確認してください:
- 401 → GitHub Secrets と Vercel Env Vars の CRON_SECRET が同一値か
- 503 → Vercel 側に CRON_SECRET が未登録か、再デプロイ未完
- 500 → Vercel Functions ログを確認 (Vercel Dashboard → Logs → /api/cron/poll-research)
```

### 経路 B: gh CLI で完結

```bash
gh workflow run "Poll Deep Research Jobs"
sleep 30  # workflow が起動するまで待機

# 最新 run の状態確認
gh run list --workflow=poll-research.yml --limit 1
gh run view --log <run-id> | tail -30
```

---

## Step 7. 店舗詳細画面で E2E 動作確認 (Claude in Chrome 推奨)

本番アプリにログインしてから、以下のプロンプトを Claude in Chrome に送信:

```
このアプリ (fw-sales) で、以下の手順で Deep Research パイプライン UI の
動作を確認してください。

1. サイドバーから「店舗一覧」を開き、任意の店舗 (テスト用) の詳細ページに移動
2. 「AI 分析」セクションの直下に「Deep Research」セクションが表示されている
   ことを確認 (タイトル + 「8 カテゴリ・51 項目の詳細調査...」の説明文)
3. 右上の「Deep Research を実行」ボタンをクリック
4. Toast 通知「Deep Research をキューに登録しました」が表示されることを確認
5. 同セクションの状態バッジが「キュー待ち」(outline トーン) に切り替わり、
   ボタンが「実行中」disabled 状態になることを確認
6. ヘッダー右上のベルアイコンに未読件数バッジが付くか、ベルクリック後の
   ドロップダウンに通知が並ぶか (※ 通知はパイプライン完了時に発火、即時には
   表示されない)
7. エリア検索画面 (/stores/new から「エリアで検索」タブ) に移動し、
   検索結果に「Deep Research を実行」CTA が一切表示されていないことを確認

各ステップでスクリーンショットを撮り、想定外の挙動があれば報告してください。
```

---

## Step 8. (任意) Phase 0 PoC 実機検証

ローカル CLI 必須 (Claude in Chrome では実行不可)。

```bash
# .env.local に GEMINI_API_KEY 設定済を確認
echo "GEMINI_API_KEY=AIza..." >> .env.local

pnpm tsx spike/deep-research-poc.ts
# Step 1: Deep Research タスク投入 → interactions/... が返るか
# Step 2: gemini-2.5-flash-lite 構造化 → JSON が返るか
```

実行ログを `.kiro/specs/deep-research-pipeline/research.md` の
`§Phase 0 PoC Execution Log` セクション末尾に追記。SDK 想定と差分があれば
`lib/ai/deep-research/client.ts` の `mapInteractionToState` 等を調整。

---

## Rollback 手順

問題発生時の即時停止:

```bash
# 1. GitHub Actions cron を停止 (最も速い blast 制御)
gh workflow disable "Poll Deep Research Jobs"

# 2. (必要なら) 進行中ジョブを失敗扱いに
psql "$DATABASE_URL" <<EOF
UPDATE research_jobs
SET status = 'failed',
    completed_at = NOW(),
    error_log = error_log || '[{"stage":"sweep","kind":"manual_rollback","message":"manual rollback","occurred_at":"$(date -u +%Y-%m-%dT%H:%M:%SZ)"}]'::jsonb
WHERE status IN ('queued', 'researching', 'structuring');
EOF

# 3. (最終手段) PR revert
gh pr create --base main --head revert/feat/deep-research-pipeline-43 \
  --title "revert: deep-research-pipeline (#54)"
```

DB マイグレーション (`0008_add_deep_research.sql`) は `research_jobs` /
`research_reports` の新規追加のみで既存テーブルへの変更ゼロのため、テーブル
を DROP しても他機能には影響しない (ただし蓄積データは失われるので安易な
DROP は避ける)。
