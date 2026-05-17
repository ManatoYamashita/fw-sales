# auth-and-notifications: デプロイ Runbook (Issue #16)

PR #30 を本番に出すまでの **7 段階手順** + 後日適用する 0005 / 0006 の手順。
仕様詳細: `.kiro/specs/auth-and-notifications/design.md` §Migration Strategy。
E2E 検証: `docs/auth-and-notifications-e2e.md` 参照。

> **重要前提**: 本リポジトリは `vercel.json` / GitHub Actions に DB migrate hook を持たない。
> マイグレーション適用はすべて **手動コマンド** で行う。Vercel auto-deploy は app コードのみ反映する。

---

## 全体フロー (依存関係)

```
[staging]                                     [本番]
0004 適用 ─── backfill --apply ──→ E2E    0004 適用 ─── backfill --apply ──→ PR #30 merge
                                              ▲
                                              │ ※ ステージング全項目通過後
                                              ▼
                                         (任意・後日) 0005 → 0006 適用
```

破壊的順序の核心:
- 0004 + backfill は **PR #30 マージ前** に staging/本番の **両方** に適用必須。これが未了で main がデプロイされると全件「未割当」表示になる。
- 0005 は **データ消失** を伴うため、staging で十分検証してから本番投入する。

---

## 事前準備 (両環境共通)

### env 変数チェックリスト

`.env.local` (ステージング/本番別) に以下 8 件設定済かを確認:

```bash
# Supabase Auth
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...    # 将来用 (現状未使用)

# Google OAuth (Supabase Project 側で設定済かも確認)
GOOGLE_OAUTH_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=GOCSPX-xxx

# Email (Resend)
RESEND_API_KEY=re_xxx
RESEND_FROM_EMAIL=noreply@your-domain.com     # Resend で verified 済

# Vercel Cron 認証
CRON_SECRET=<32文字以上ランダム>

# 既存
DATABASE_URL=postgres://...
NEXT_PUBLIC_APP_URL=https://your-domain.com   # メール本文の店舗詳細リンク用
```

### Supabase Project 側設定

1. **Authentication > Providers > Google** を有効化
2. **Authorized redirect URIs** に `https://<app-domain>/auth/callback` を登録
3. **Authorized email domains** で社内ドメインのみ許可 (自由登録防止)

---

## 段階別手順

### Step 1: ステージング DB に 0004 適用

```bash
# ステージング用 .env.local を有効にして
pnpm drizzle-kit migrate
```

期待結果: `profiles` テーブル作成、`stores.assigned_*_user_id` / `deals.assigned_sales_user_id` / `notifications.user_id` 列追加、`handle_new_user()` trigger + `on_auth_user_created` 設置、`idx_notifications_user_id` 作成。

検証 SQL:

```sql
SELECT to_regclass('public.profiles'), to_regclass('public.notifications');
-- 両方 NOT NULL なら OK

SELECT column_name FROM information_schema.columns
  WHERE table_name='stores'
    AND column_name IN ('assigned_planner_user_id', 'assigned_sales_user_id');
-- 2 行返れば OK

SELECT trigger_name FROM information_schema.triggers
  WHERE trigger_name='on_auth_user_created';
-- 1 行返れば OK
```

### Step 2: ステージング DB に backfill 適用

```bash
# scripts/backfill-assignees.ts は Phase 8 で削除済のため git 履歴から復元
git checkout 0ccee53 -- scripts/backfill-assignees.ts

# まず dry-run でマッピング表を確認
pnpm tsx scripts/backfill-assignees.ts --dry-run

# マッピングが妥当であれば apply
pnpm tsx scripts/backfill-assignees.ts --apply

# 復元したスクリプトは作業領域から削除 (PR に含めない)
git checkout HEAD -- scripts/backfill-assignees.ts 2>/dev/null \
  || rm -f scripts/backfill-assignees.ts
```

検証 SQL:

```sql
SELECT COUNT(*) AS total, COUNT(assigned_planner_user_id) AS mapped_planner,
       COUNT(assigned_sales_user_id) AS mapped_sales FROM stores;
-- mapped_planner / mapped_sales が total と等しい (または旧 text が空文字の行ぶん少ない)

SELECT COUNT(*) FROM profiles WHERE role='placeholder';
-- backfill で新規生成された placeholder の件数 (DRY-RUN 出力と一致する想定)
```

### Step 3: ステージング preview デプロイ + E2E

```bash
# Vercel preview は PR #30 push 時に自動生成済
# Vercel ダッシュボードから preview URL を確認
open https://github.com/ManatoYamashita/fw-sales/pull/30
# → Vercel Preview Comments のリンクを開く
```

`docs/auth-and-notifications-e2e.md` の 9 項目チェックリストを 1 サイクル通過させる:

- [ ] 1. 未ログイン保護リダイレクト
- [ ] 2. Google サインインフロー
- [ ] 3. サインアウト
- [ ] 4. 担当者選択 UI (Combobox 化)
- [ ] 5. 表示への profile 名 join
- [ ] 6. Mock モード動作確認 (`USE_MOCK_DB=true pnpm dev`)
- [ ] 7. Cron リマインダー (curl で疑似発火 → メール受信確認)
- [ ] 8. 認証バイパス系の防御 (CRON_SECRET 不一致 401 / mode クエリ不正 400 / RESEND_API_KEY 未設定でも 200)
- [ ] 9. 全体品質ゲート (`pnpm typecheck && pnpm lint && pnpm build && pnpm test`)

### Step 4: 本番 DB に 0004 適用

```bash
# 本番用 .env.local を有効にして
pnpm drizzle-kit migrate
```

検証 SQL: Step 1 と同じ。

### Step 5: 本番 DB に backfill 適用

```bash
git checkout 0ccee53 -- scripts/backfill-assignees.ts

pnpm tsx scripts/backfill-assignees.ts --dry-run
# → マッピング表をレビュー後

pnpm tsx scripts/backfill-assignees.ts --apply

rm -f scripts/backfill-assignees.ts
```

検証 SQL: Step 2 と同じ。

### Step 6: PR #30 を main へマージ

```bash
gh pr merge 30 --merge --delete-branch
# または GitHub UI からマージ
```

Vercel auto-deploy が走り、本番 app コードに Phase 1-12 が反映される。

### Step 7: マージ後動作確認

本番ドメインで:

1. 未ログインで `/dashboard` → `/login` リダイレクト
2. Google サインインで `/dashboard` 復帰、ヘッダーアバター表示
3. `/stores` 一覧で担当者列に profile 名が表示される
4. `/api/cron/deal-reminders` を curl で疑似発火し 200 が返る

問題があれば即 Vercel ダッシュボードから前リビジョン (PR #23 時点) にロールバック。

---

## 後日: 0005 / 0006 適用 (任意)

PR #30 マージ後、app は旧 text 列を一切参照しないため、**いつでも 0005 を適用可能**。
ただし **データ消失を伴う** ため staging で十分検証してから本番投入する。

### 0005 適用手順

```bash
# 1. ステージング DB で適用
pnpm drizzle-kit migrate

# 2. ステージングで E2E 再走 (担当者表示・編集・絞り込みが動作するか)

# 3. 本番 DB で適用
pnpm drizzle-kit migrate
```

### 0006 適用手順

```bash
# 適用前確認 SQL (孤児 user_id がないか):
SELECT COUNT(*) FROM notifications n WHERE n.user_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = n.user_id);
# 0 でなければ該当行を整理してから 0006 を適用

# 0006 適用
pnpm drizzle-kit migrate
```

低リスク (FK 制約追加のみ、データ変更なし)。

---

## ロールバック手順

### Step 1-3 のロールバック (0004 + backfill)

`design.md §Migration Strategy / Phase 1 ロールバック手順` の 8 ステップ SQL を逆順で実行。データ依存なし。

### Step 4-6 のロールバック (本番反映済)

1. Vercel ダッシュボードから前リビジョン (PR #23 マージ時点) にロールバック (= app コードのみ前に戻す)
2. DB は backfill 後の状態のまま (app は旧 text 列を読み戻すので両立する)
3. 必要なら 0004 ロールバック SQL を実行

### 0005 適用後のロールバック

**データ復元が必要**。Phase 2 適用後は旧 text 列がドロップされているため、backup から個別 UPDATE を組む必要がある。本番投入前にステージング検証を必須とする。

### 0006 適用後のロールバック

```sql
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_user_id_profiles_id_fk;
```

FK 制約のみの追加なのでロールバックは容易。

---

## トラブルシューティング

### 「Vercel 上で `pnpm build` が失敗する」

Phase 12 の dynamic import fix (commit 856ce4b) が適用済かを確認。`lib/email/templates/_layout.tsx` 内で `await import("react-dom/server")` が使われていれば OK。静的 import に戻っている場合は Turbopack の React-on-Server エラーが発生する。

### 「ログイン後に `/dashboard` で 500」

`getCurrentProfile()` が null を返している可能性。Supabase の `on_auth_user_created` trigger が動作していない (= `profiles` レコードが auto-create されていない) ことが多い。

```sql
SELECT trigger_name, event_object_table FROM information_schema.triggers
  WHERE trigger_name='on_auth_user_created';
-- 0 行なら 0004 マイグレーションが未適用
```

### 「Cron が動かない」

`vercel.json` の cron が登録されているか Vercel ダッシュボードで確認。`CRON_SECRET` 環境変数が Vercel 側にも設定されているかを確認 (Vercel Project Settings > Environment Variables)。

### 「本番で `column "..." does not exist` の 500」(孤児マイグレーションの検出・復旧)

複数ブランチが並行開発で同一 idx の Drizzle マイグレーションを生成し、merge 時にファイル名衝突を解消せずマージされた場合、後者は `_journal.json` に登録されない **孤児** となる。`pnpm drizzle-kit migrate` は journal 未登録 SQL を無視するため、本番 DB に DDL が未適用の状態が発生する。

**過去事例**: `0004_add_store_google_place_id.sql` (Issue #14 area-search × Issue #16 auth-and-notifications) — `stores.google_place_id` 列欠落で本番 `/stores` が 500 を返した。`0007_add_store_google_place_id.sql` として再生成し決着。

#### 検出

```bash
# drizzle/ 配下の SQL ファイル数と _journal.json の entries 数を比較
ls drizzle/*.sql | wc -l
jq '.entries | length' drizzle/meta/_journal.json
# 値が異なる、または同一 idx (例: 0004) の SQL が複数存在する場合は孤児あり
ls drizzle/ | grep -E '^[0-9]{4}_' | awk -F'_' '{print $1}' | sort | uniq -d
# 出力に番号が出れば、その idx が衝突している
```

#### 復旧手順

1. **本番 DB に DDL を冪等で先行適用** (`drizzle-kit migrate` は走らせない):

   Supabase Dashboard → SQL Editor で、孤児 SQL の DDL を `IF NOT EXISTS` 付きで実行。

   ```sql
   -- 例: stores.google_place_id 列の場合
   ALTER TABLE stores ADD COLUMN IF NOT EXISTS google_place_id text;
   CREATE INDEX IF NOT EXISTS stores_google_place_id_idx ON stores(google_place_id);
   ```

   `__drizzle_migrations` テーブルには触れない (後続のチームメンバーが migrate を流した際、idx が補完される設計)。

2. **リポジトリの孤児を削除 → drizzle-kit で再生成**:

   ```bash
   rm drizzle/0004_<orphan-name>.sql   # 孤児を削除
   pnpm drizzle-kit generate --name <descriptive-name>
   # → drizzle/00NN_<name>.sql、drizzle/meta/00NN_snapshot.json、journal idx=NN が生成
   ```

3. **生成 SQL を `IF NOT EXISTS` に手編集** (本番に既に列が存在するため、`drizzle-kit migrate` 時の重複適用を防ぐ):

   ```sql
   ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "google_place_id" text;
   CREATE INDEX IF NOT EXISTS "stores_google_place_id_idx" ON "stores" USING btree ("google_place_id");
   ```

4. **PR をマージ後、次回 migrate 実行時に journal が自動補完される** (`IF NOT EXISTS` で no-op、tracking テーブルに idx が追記)。

#### 再発防止

- PR レビュー時、`drizzle/` ディレクトリの変更があれば必ず `_journal.json` の最大 idx と SQL ファイルの最大番号が一致しているかを確認。
- 同一 idx の SQL ファイルが複数存在しないかを `ls drizzle/ | awk -F'_' '{print $1}' | sort | uniq -d` で機械的にチェックする CI step を将来導入検討。
