# auth-and-notifications: 手動 E2E チェックリスト (Issue #16)

本仕様の統合検証用チェックリスト。ステージング環境で 1 サイクル通過することをリリース基準とする。
仕様: `.kiro/specs/auth-and-notifications/` 参照。

---

> **2026-05-17 更新**: 商談リマインダー Cron + Resend メール通知関連 (項目 7 / 8 の全項目 / 9 の `pnpm test` 件数) は削除されました。当該セクションは取り消し線で履歴を残しています。

## ステージング実機検証記録 (2026-09-07)

対象: [Vercel Preview (dpl_91cUcFs8N7FDHpXbAp3TWyiT388u)](https://fw-sales-gaymv8o9t-shinsotsu-gourmet.vercel.app)

- [x] `/login` からGoogle OAuthのアカウント選択画面へ遷移
- [x] Google認証後に`/auth/callback`を経由して`/stores`へ復帰
- [x] サイドバーのProfile名 `山本元` とロール `管理者` を表示
- [x] ユーザーメニューからサインアウトし、`/login`へ復帰
- [x] サインアウト後に`/stores`へアクセスすると`/login?redirect=%2Fstores`へリダイレクト
- [x] 未ログイン状態で`/dashboard`・`/deals`・`/pipeline`へアクセスすると、各`/login?redirect=...`へリダイレクト
- [x] ヘッダー右上のアバター・Profile名・ロールを表示

- [x] ヘッダーアバターをクリックするとUserMenuが開き、サインアウトで`/login`へ戻る

---

## 前提セットアップ

- [ ] `.env.local` に 5 件の環境変数が設定済 (`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` / `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`)
  - ~~Resend / Cron 関連 (`RESEND_API_KEY` / `RESEND_FROM_EMAIL` / `CRON_SECRET`) は削除済~~
    (`CRON_SECRET` のみ 2026-09-05 に Supabase keepalive 用途で復活 / Issue #242)
- [ ] Supabase プロジェクトで Google OAuth プロバイダーが有効化済
- ~~[ ] Resend で `RESEND_FROM_EMAIL` のドメインが verified 済~~ — 削除済
- [ ] マイグレーション 0001-0006 を staging DB に適用済
- [ ] (適用したい場合のみ) `git checkout 0ccee53 -- scripts/backfill-assignees.ts && pnpm tsx scripts/backfill-assignees.ts --apply` を 0005 適用前に実施済

---

## E2E チェックリスト (6 項目)

> 項目 7 (商談リマインダー Cron) / 項目 8 (認証バイパス系の防御) は削除済機能のため取り消し線扱い。

### 1. 未ログイン保護リダイレクト
- [x] 未ログイン状態で `/dashboard` にアクセス → `/login?redirect=/dashboard` にリダイレクトされる (2026-09-07)
- [x] 未ログイン状態で `/stores` / `/deals` / `/pipeline` 等にアクセス → 同様に `/login?redirect=...` にリダイレクト (2026-09-07 `/stores`・`/deals`・`/pipeline`で確認)
- [ ] `/login` / `/auth/callback` / `/api/cron/*` は proxy を通り抜けて到達可能

### 2. Google サインインフロー
- [x] `/login` で「Google でサインイン」ボタンを押下 → Google アカウント選択画面に遷移 (2026-09-07)
- [x] 同意後 `/auth/callback` 経由で `?redirect` クエリの戻り先 (デフォルト `/dashboard`) に着地 (2026-09-07 `/stores`で確認)
- [x] ヘッダー右上のアバター + 表示名が現ユーザーの Profile を反映している (2026-09-07 新Previewで確認)
- [x] サイドバー下部にも現ユーザー名 / ロールが表示されている (2026-09-07)

### 3. サインアウト
- [x] ヘッダーのアバターをクリック → UserMenu が開く (2026-09-07 新Previewで確認)
- [x] 「サインアウト」を選択 → セッションが破棄され `/login` に戻る (2026-09-07 新Previewで確認)

### 4. 担当者選択 UI (user 参照化)
- [ ] `/stores/new` の「プランナー」「営業担当」が text input ではなく **profile 名の Select** になっている
- [ ] 「未割当」選択肢が含まれる
- [ ] 既定値: プランナーは現ユーザー、営業担当は未割当
- [ ] `/deals/new?store=...` の「営業担当」も Select 化 (既定: 店舗の `assigned_sales_user_id` → 現ユーザー)
- [ ] `/stores/{id}` 詳細画面 / `/stores/{id}/edit` の編集フォームも同様

### 5. 表示への profile 名 join
- [ ] `/stores` 一覧の「営業担当」列に Profile.display_name が表示される (未割当は `—`)
- [ ] `/pipeline` Kanban カード下部に営業担当名が表示される
- [ ] `/deals` 一覧 / `/deals/{id}` ヘッダーにも担当者名が表示される

### ~~6. Mock モード動作確認~~ — 削除済 (Issue #39)
- ~~`USE_MOCK_DB=true pnpm dev` で起動 → `/login` を介さず `/dashboard` に直接到達できる~~
- ~~ヘッダーアバターが固定 mock profile を表示~~
- ~~担当者 Select に Mock seed の 4 profile が出る~~

### ~~7. 商談リマインダー Cron~~ — 削除済 (2026-05-17)
- ~~商談を翌日付で 1 件以上作成 (`/deals/new` で `date=翌日 JST`)~~
- ~~翌朝 JST 07:00 を待つ、または curl で疑似発火:~~
  ~~`curl -i -H "Authorization: Bearer ${CRON_SECRET}" 'http://localhost:3000/api/cron/deal-reminders?mode=tomorrow'`~~
- ~~HTTP 200 + JSON `{ mode, bundles, sent, skipped, failed }` が返る~~
- ~~担当者の email に `[fw-sales] 明日の商談リマインダー (N 件)` が届く~~
- ~~`mode=today` も同様に動作~~

### ~~8. 認証バイパス系の防御~~ — 削除済 (2026-05-17)
- ~~`CRON_SECRET` 未設定 / 不一致 → 401~~ (Vercel Preview で curl 3 ケース確認済の履歴)
- ~~`mode` クエリが `tomorrow` / `today` 以外 → 400~~
- ~~`RESEND_API_KEY` 未設定環境でも `/api/cron/deal-reminders` は 200 を返し (送信は `skipped` カウントに記録)、警告ログのみ出る~~
- ~~認証 / 一覧 / 編集等の主要 UI は `RESEND_API_KEY` 未設定でも動作する~~

### 9. 全体品質ゲート
- [ ] `pnpm typecheck` 通過
- [ ] `pnpm lint` 通過 (worktree 由来の既存 issue は除外)
- [ ] `pnpm test` 通過 (Phase 11 で追加した 16 件 + 既存テスト)
- [ ] `pnpm build` 通過

---

## ロールバック手順 (本番障害時)

### Phase 1 (0004) のロールバック
`design.md §Migration Strategy / Phase 1 ロールバック手順` の 8 ステップ SQL を逆順で実行。データ依存なし。

### Phase 2 (0005) のロールバック
**データ復元が必要**。Phase 2 適用後は旧 text 列がドロップされているため、backup から個別 UPDATE を組む必要がある。本番投入前にステージング検証必須。

### Phase 10 (0006) のロールバック
```sql
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_user_id_profiles_id_fk;
```
FK 制約のみの追加なので、ロールバックは容易。
