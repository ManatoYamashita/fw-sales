# Implementation Plan — auth-and-notifications

参照: `requirements.md` / `design.md` / `research.md`(2026-05-10 design-review 反映済)
カバー要件: 1.1〜8.3(計 45 件)

---

## 1. Foundation: 依存追加と環境構成

- [x] 1.1 認証 / メール SDK 依存をインストール
  - `@supabase/supabase-js@^2.45`、`@supabase/ssr@^0.5`、`resend@^4` を `dependencies` に追加
  - `pnpm install` 完了後に `pnpm typecheck` がエラーなく通過する
  - 完了状態: `package.json` の dependencies に 3 パッケージが追加され、`pnpm-lock.yaml` が更新済
  - _Requirements: 1.2, 4.1_

- [x] 1.2 環境変数雛形を整備
  - `.env.example` に `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` / `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` / `RESEND_API_KEY` / `RESEND_FROM_EMAIL` / `CRON_SECRET` を追記
  - 各変数にコメントで用途と「未設定時の挙動」を記述(認証関連=サインイン失敗、メール=no-op、CRON=401)
  - 完了状態: 8 つの環境変数が `.env.example` に存在し、`grep` で全件確認できる
  - _Requirements: 8.1, 8.2, 8.3_

- [x] 1.3 `CACHE_TAGS` を拡張
  - `lib/cache.ts` の `CACHE_TAGS` に `profiles: "profiles"`、`profile: (id) => 'profile:${id}'`、`notifications: "notifications"`、`notification: (id) => 'notification:${id}'` を追加
  - 完了状態: 4 つの新タグが定数として export され、`pnpm typecheck` 通過
  - _Requirements: 2.1, 2.3, 7.1_
  - _Boundary: lib/cache.ts_

- [x] 1.4 (P) Profile / Notification ドメイン型を定義
  - `types/profile.ts` に `Profile`(id, email, display_name, avatar_url, role, created_at, updated_at)、`ProfileInput`、`PlaceholderProfileInput`、`ProfileRole` 型を定義
  - `types/notification.ts` に `Notification`(id, user_id, …、#14 と整合する暫定形)を定義
  - `types/index.ts` から re-export
  - 完了状態: 両ファイル作成、`pnpm typecheck` 通過、他レイヤーから `import type { Profile } from "@/types/profile"` で参照可能
  - _Requirements: 2.1, 2.5, 7.1_
  - _Boundary: types/profile.ts, types/notification.ts_

---

## 2. Data Layer: プロフィール / 通知のリポジトリ整備

- [x] 2.1 ProfileRepository interface を定義
  - `lib/repositories/profile-repository.ts` に `findById` / `findByEmail` / `findByDisplayName` / `findManyByIds` / `findAll({excludePlaceholders?})` / `createPlaceholder` を declare
  - design.md §ProfileRepository の Service Interface に従う
  - 完了状態: interface export 完了、Mock / DB 両実装が後続タスクで参照可能
  - _Requirements: 2.x, 3.4, 3.5, 3.7_
  - _Boundary: lib/repositories/profile-repository.ts_

- [x] 2.2 (P) ProfileRepository の DB 実装
  - `lib/db/profile-repository.ts` に Drizzle ベース実装を作成
  - `createPlaceholder` は `id = uuid_generate_v4()`、`email = 'placeholder-${slug}@local.invalid'`、`role = 'placeholder'` で INSERT
  - 完了状態: 実装完了、`lib/db/index.ts` から `dbProfileRepo` / `makeProfileRepo` を export、`pnpm typecheck` 通過
  - _Requirements: 2.1, 2.5, 3.4, 3.5_
  - _Boundary: lib/db/profile-repository.ts_
  - _Depends: 2.1_

- [x] 2.3 (P) ProfileRepository の Mock 実装
  - `lib/mock/profile.ts` に Map ベース実装を作成、`lib/mock/db.ts` の共有 globalThis ストアに合流
  - dev 環境で固定 mock profile (`PLACEHOLDER_DEV_PROFILE_ID`) を seed として持たせるエクスポートを用意(後続タスク 6.4 で使う)
  - 完了状態: `mockProfileRepo` を export、`USE_MOCK_DB=true` で `repos.profile.findById(...)` がモックデータを返す
  - _Requirements: 2.1, 2.5_
  - _Boundary: lib/mock/profile.ts_
  - _Depends: 2.1_

- [x] 2.4 NotificationRepository interface と Mock / DB 実装
  - `lib/repositories/notification-repository.ts` に `findByUserId(userId, {unreadOnly?})` / `markAsRead(notificationId, userId)` / `insert(input)` を declare
  - `lib/db/notification-repository.ts` / `lib/mock/notification.ts` を実装
  - `markAsRead` は `userId` 一致を必ず確認(他人の既読化を禁止する invariants)
  - 完了状態: 3 ファイル作成、`repos.notification.findByUserId(uid)` でモック / DB 両経路が動作
  - _Requirements: 7.1, 7.2, 7.3_
  - _Boundary: lib/repositories/notification-repository.ts, lib/db/notification-repository.ts, lib/mock/notification.ts_
  - _Depends: 2.1_

- [x] 2.5 Repos / TxRepos に profile / notification を統合
  - `lib/repositories/index.ts` の `TxRepos` / `Repos` interface に `profile: ProfileRepository`、`notification: NotificationRepository` を追加
  - `buildRepos()` の Mock / DB 経路の両方で `profile` / `notification` を組込み
  - 完了状態: `repos.profile.findById(...)` / `repos.notification.findByUserId(...)` がアプリ全体から呼び出せる、`pnpm typecheck` 通過
  - _Requirements: 2.1, 7.1_
  - _Boundary: lib/repositories/index.ts_
  - _Depends: 2.2, 2.3, 2.4_

- [x] 2.6 lib/queries/profiles.ts を実装
  - `'use cache'` + `cacheTag(CACHE_TAGS.profiles)` で `getAllProfiles({excludePlaceholders?})` / `getProfileById(id)` を実装
  - 完了状態: Server Component から `await getAllProfiles()` でプロフィール配列を取得できる
  - _Requirements: 1.5, 3.7_
  - _Boundary: lib/queries/profiles.ts_
  - _Depends: 2.5_

---

## 3. Auth Adapter: Supabase クライアント

- [x] 3.1 (P) Server クライアントヘルパ
  - `lib/supabase/server.ts` に `getSupabaseServerClient()`(`createServerClient` ラッパ、Next.js 16 async cookies に対応)を実装
  - `getCurrentSession()`(session 不在は null)、`getCurrentProfile()`(`repos.profile.findById(session.userId)` 経由)を実装
  - 環境変数未設定時は warn ログ + `getSupabaseServerClient()` で throw、`getCurrentSession()` は null 返却
  - `USE_MOCK_DB=true` 時は session を固定 `PLACEHOLDER_DEV_PROFILE_ID` で返すバイパスを実装
  - 完了状態: Server Component / Server Action から `await getCurrentProfile()` で Profile が取れる
  - _Requirements: 1.3, 1.5, 1.6, 8.2_
  - _Boundary: lib/supabase/server.ts_
  - _Depends: 1.1, 2.5_

- [x] 3.2 (P) Browser クライアントヘルパ
  - `lib/supabase/client.ts` に `getSupabaseBrowserClient()`(`createBrowserClient` ラッパ、singleton)を実装
  - 完了状態: Client Component から `signInWithOAuth({provider:'google'})` を起動できる
  - _Requirements: 1.2_
  - _Boundary: lib/supabase/client.ts_
  - _Depends: 1.1_

- [x] 3.3 (P) Middleware セッションヘルパ
  - `lib/supabase/middleware.ts` に `updateSession(request: NextRequest): Promise<UpdateSessionResult>` を実装
  - `request.cookies` / `response.cookies` を `@supabase/ssr` の cookies adapter に橋渡し、refresh されたセッションを response cookies に反映
  - `USE_MOCK_DB=true` 時は `isAuthenticated: true`、`userId: PLACEHOLDER_DEV_PROFILE_ID` を返すバイパス
  - 完了状態: middleware から呼ばれて `{ response, isAuthenticated, userId }` が返る
  - _Requirements: 1.1_
  - _Boundary: lib/supabase/middleware.ts_
  - _Depends: 1.1_

---

## 4. Auth Routes & UI

- [x] 4.1 ルート middleware を実装
  - `middleware.ts` を repo ルートに新規作成、`config.matcher` で `(main)` 配下のみ対象、`/login`、`/auth/*`、`/api/cron/*`、`/_next/*`、静的アセットを除外
  - 未認証時は `/login?redirect=${encodeURIComponent(pathname)}` へ 302、認証済は `response` を return
  - 完了状態: `pnpm dev` で未ログイン状態 `/dashboard` アクセスが `/login?redirect=/dashboard` にリダイレクトされる
  - _Requirements: 1.1, 1.5_
  - _Boundary: middleware.ts_
  - _Depends: 3.3_

- [x] 4.2 (P) `/login` ページとサインインボタン
  - `app/login/page.tsx`(Server Component)で `redirect` クエリと `error` クエリを読み、ボタンを描画
  - `app/login/_components/google-signin-button.tsx`(Client Component)で `signInWithOAuth({ provider:'google', options:{ redirectTo: '/auth/callback?redirect=${redirect}' } })` を起動
  - エラークエリがあれば日本語メッセージで `Alert` 風に表示
  - 完了状態: `/login` を直接訪問するとボタンと(エラー時)メッセージが表示される。クリックで Google 同意画面に遷移
  - _Requirements: 1.2, 1.4, 1.7_
  - _Boundary: app/login_
  - _Depends: 3.2_

- [x] 4.3 (P) `/auth/callback` Route Handler
  - `app/auth/callback/route.ts` を Route Handler で実装、`code` クエリを `exchangeCodeForSession` に渡してセッション確立
  - 失敗時は `/login?error=oauth_failed` に 302、成功時は `redirect` クエリ(なければ `/dashboard`)に 302
  - 完了状態: Google 同意完了後に当該ハンドラが呼ばれ、cookie 確立後に元ルートへ復帰する
  - _Requirements: 1.3, 1.4, 2.1_
  - _Boundary: app/auth/callback_
  - _Depends: 3.1_

- [x] 4.4 サインアウト Server Action
  - `lib/actions/auth-actions.ts` に `"use server"` で `signOutAction(): Promise<ActionResult<{redirectTo: string}>>` を実装
  - `getSupabaseServerClient().auth.signOut()` を呼び `success({redirectTo: "/login"})` を返す
  - 失敗時は `failure(...)` で日本語メッセージを返す
  - 完了状態: 任意の Client Component から `signOutAction()` を呼ぶとセッション破棄され `redirectTo` が返る
  - _Requirements: 1.6_
  - _Boundary: lib/actions/auth-actions.ts_
  - _Depends: 3.1_

- [x] 4.5 UserMenu コンポーネントと Topbar 統合
  - `components/layout/user-menu.tsx`(Client Component)を新規作成、props で `profile: Profile` を受け取りアバター + ドロップダウン(表示名 / メール / サインアウト)を描画
  - `components/layout/topbar.tsx` の Bell 隣に UserMenu を配置(現在ログイン中の profile を `(main)/layout.tsx` 経由で受け取る props 化)
  - サインアウトクリック時に `signOutAction` 呼出 → `router.push(redirectTo)`
  - 完了状態: `pnpm dev` で `/dashboard` アクセス時にヘッダーにアバターと表示名が出る
  - _Requirements: 1.5, 1.6_
  - _Boundary: components/layout/user-menu.tsx, components/layout/topbar.tsx_
  - _Depends: 4.4, 2.6_

- [x] 4.6 `(main)` レイアウトに currentProfile を注入
  - `app/(main)/layout.tsx` で `await getCurrentProfile()` を取得、`<Topbar currentProfile={profile} />` 形で props 経由で渡す
  - profile が null の場合は middleware が拾うはずだが、防御的に `redirect("/login")` を発火
  - 完了状態: 認証済リクエストでヘッダーが正しい profile を表示、未認証(middleware バイパス時)は `/login` へ
  - _Requirements: 1.1, 1.5_
  - _Boundary: app/(main)/layout.tsx_
  - _Depends: 4.5_

---

## 5. Email Layer

- [x] 5.1 Resend クライアントと no-op フォールバック
  - `lib/email/client.ts` に `import "server-only"` 宣言、`emailClient.send(message)` を実装
  - `RESEND_API_KEY` 未設定 → `{ kind: 'noop', reason: 'missing_api_key' }` 返却 + warn ログ(同 process で 1 回のみ)
  - `to.endsWith('@local.invalid')` → 同様に noop(placeholder 保護)
  - 送信成功 → `{ kind: 'ok', id }`、失敗 → `{ kind: 'failed', error }` + error ログ。throw しない
  - `buildSubject(raw)` で件名先頭に `[fw-sales] ` を付与する関数を export
  - 完了状態: dummy 呼出 `await emailClient.send({...})` が `RESEND_API_KEY` 未設定時に noop を返す(unit test で確認可)
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 8.3_
  - _Boundary: lib/email/client.ts_
  - _Depends: 1.1, 1.2_

- [x] 5.2 (P) 共通 HTML レイアウトテンプレート
  - `lib/email/templates/_layout.tsx` に共通 HTML レイアウト(ヘッダー / 本文 / フッターロゴ / `[fw-sales]` プレフィックス)を実装
  - JSX を `react-dom/server` の `renderToStaticMarkup` で HTML 化するヘルパも同モジュールに含める
  - 完了状態: 任意のテンプレートが `renderEmail(<TemplateProps />)` で HTML 文字列を生成できる
  - _Requirements: 4.4_
  - _Boundary: lib/email/templates/_layout.tsx_
  - _Depends: 5.1_

- [x] 5.3 (P) 調査ジョブ完了 / 失敗テンプレート
  - `lib/email/templates/research-job-completed.tsx` に件名(成功 N 件 / 失敗 M 件 を含む)+ 本文(対象店舗一覧 + `/stores` リンク)を実装
  - `lib/email/templates/research-job-failed.tsx` に件名(失敗通知)+ 本文(失敗概要 + 再実行案内 + 対象画面リンク)を実装
  - 完了状態: 両テンプレートが Profile / Job / Stores を入力に取り `EmailMessage`(subject / html / text)を生成する
  - _Requirements: 5.4, 5.5, 5.6_
  - _Boundary: lib/email/templates/research-job-completed.tsx, lib/email/templates/research-job-failed.tsx_
  - _Depends: 5.2_

- [x] 5.4 (P) 商談リマインダーテンプレート
  - `lib/email/templates/deal-reminder.tsx` に件名(明日 / 本日 + 件数)+ 本文(商談ごとの店舗名・形式・提案内容 + 店舗詳細リンク)を実装
  - 入力: `{ profile: Profile, mode: 'tomorrow'|'today', deals: ReminderDealItem[] }`
  - 完了状態: 入力データに対して `EmailMessage` を生成する関数が export される
  - _Requirements: 6.5, 6.6_
  - _Boundary: lib/email/templates/deal-reminder.tsx_
  - _Depends: 5.2_

---

## 6. Migration Phase 1 + Backfill

- [x] 6.1 Drizzle スキーマに profiles + 担当者 user_id 列を追加
  - `lib/db/schema.ts` に `profiles` テーブル (uuid PK)、`stores.assigned_planner_user_id` / `stores.assigned_sales_user_id` / `deals.assigned_sales_user_id`(全 nullable uuid → `profiles.id` references)を追加
  - `notifications.user_id`(nullable uuid)も追加(#14 の状態に応じて、後続タスク 10.x で調整)
  - `store_research_jobs.triggered_by_user_id`(nullable uuid、新カラム名)を追加(#14 が text で導入済の場合のみ)
  - 完了状態: `pnpm drizzle-kit generate` で 0004 マイグレーション SQL が生成される
  - _Requirements: 2.1, 3.1, 3.2, 5.1, 7.1_
  - _Boundary: lib/db/schema.ts_

- [x] 6.2 マイグレーション 0004 を仕上げる
  - `drizzle/0004_add_profiles_and_assignee_user_id.sql` に以下を追加(`drizzle-kit generate` 出力に追記):
    - `profiles` テーブル定義 + `FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE`(raw SQL)
    - `handle_new_user()` 関数 + `on_auth_user_created` trigger(SECURITY DEFINER)
    - 既存出力の `assigned_*_user_id` 列追加 + FK
  - 完了状態: ローカル staging DB で `pnpm drizzle-kit migrate` が成功し、`profiles` テーブルと trigger が作成される
  - _Requirements: 2.1, 2.2, 3.1, 3.2_
  - _Boundary: drizzle/0004_*.sql_
  - _Depends: 6.1_

- [x] 6.3 Mock seed にプロフィール基準データを追加
  - `lib/mock/seed.ts` に `SEED_PROFILES`(`PLACEHOLDER_DEV_PROFILE_ID` を含む member プロフィール 2-3 件、placeholder 1 件)を定義
  - 既存 `SEED_STORES` / `SEED_DEALS` / `SEED_HANDOFFS` の `assigned_*` を text → uuid 参照に書換
  - 完了状態: `USE_MOCK_DB=true` で `pnpm dev` 起動、`/stores` 一覧で担当者 join が表示される(後続 7.x で UI 反映)
  - _Requirements: 2.1, 3.1, 3.2_
  - _Boundary: lib/mock/seed.ts_
  - _Depends: 2.3, 6.1_

- [x] 6.4 Mock リポジトリを新スキーマに追従
  - `lib/mock/store.ts`、`lib/mock/deal.ts`、`lib/mock/research.ts`、`lib/mock/handoff.ts` の参照箇所(filter / sort)を `assigned_*_user_id` ベースに書換
  - 完了状態: `pnpm typecheck` が通り、Mock 経路の `repos.store.findAll()` が新スキーマで正常動作
  - _Requirements: 3.1, 3.2, 3.8_
  - _Boundary: lib/mock/store.ts, lib/mock/deal.ts, lib/mock/research.ts, lib/mock/handoff.ts_
  - _Depends: 6.3_

- [x] 6.5 DB リポジトリを新スキーマに追従
  - `lib/db/store-repository.ts`、`lib/db/deal-repository.ts` の `assigned_*` 参照を新カラムに書換、必要に応じ JOIN クエリ追加
  - 完了状態: `pnpm typecheck` 通過、DB 経路の `repos.store.findAll()` が新スキーマで動作
  - _Requirements: 3.1, 3.2, 3.8_
  - _Boundary: lib/db/store-repository.ts, lib/db/deal-repository.ts_
  - _Depends: 6.1_

- [x] 6.6 バックフィルスクリプトを実装
  - `scripts/backfill-assignees.ts` を新規作成、`tsx scripts/backfill-assignees.ts --dry-run|--apply` の 2 モードをサポート
  - 対象: `stores.assigned_planner` / `stores.assigned_sales` / `deals.assigned_sales` / `store_research_jobs.triggered_by`(後者は #14 が text 導入済のときのみ)
  - 各カラムごとに distinct 抽出 → `profiles.display_name` 完全一致 → 不一致は `createPlaceholder({slug: slugify(name)})` で生成 → UPDATE 文発行(apply 時のみ)
  - dry-run はマッピング表(対象テーブル / 旧値 / 種別 / 新 uuid)を `console.log` 出力、apply は最後にマッピング件数サマリを出力
  - 完了状態: `pnpm tsx scripts/backfill-assignees.ts --dry-run` がローカル DB で実行成功し、出力にマッピング表が表示される
  - _Requirements: 3.4, 3.5, 5.1_
  - _Boundary: scripts/backfill-assignees.ts_
  - _Depends: 6.2, 2.5_

---

## 7. 担当者 user 参照化(アプリ側)

- [x] 7.1 担当者カラム関連の型を更新
  - `types/store.ts` に `assigned_planner_user_id: string | null` / `assigned_sales_user_id: string | null` を追加、旧 `assigned_planner` / `assigned_sales` を削除(またはコメントで deprecate)
  - `types/deal.ts` の `assigned_sales` を `assigned_sales_user_id: string | null` に置換
  - 完了状態: `pnpm typecheck` 通過。型の参照箇所が後続タスクで全件補正可能
  - _Requirements: 3.1, 3.2, 3.3_
  - _Boundary: types/store.ts, types/deal.ts_
  - _Depends: 6.1_

- [x] 7.2 Server Action の FormData 読込を user 参照化
  - `lib/actions/store-actions.ts` の `readString(formData, "assigned_planner")` を `readNullableString(formData, "assigned_planner_user_id")` に置換、空文字 → null 化
  - `lib/actions/deal-actions.ts` も `assigned_sales_user_id` に置換
  - profile 存在検証(値が NULL でない場合に `repos.profile.findById(...)` で確認)を追加、不正時は `failure(...)`
  - 完了状態: 担当者を空 / 既存 profile / 存在しない uuid で create / update を投げ、それぞれの動作が想定どおり(空=NULL 保存、存在=保存、不正=エラー)
  - _Requirements: 3.3, 3.7, 3.8_
  - _Boundary: lib/actions/store-actions.ts, lib/actions/deal-actions.ts_
  - _Depends: 7.1, 2.6_

- [x] 7.3 担当者選択フォームを Combobox 化
  - `app/(main)/stores/new/_components/store-new-form.tsx` の `assigned_planner` / `assigned_sales` text input を `<select>` または既存 UI ライブラリの Combobox に変更、選択肢は `getAllProfiles({excludePlaceholders: false})` の結果から構築
  - `app/(main)/deals/new/_components/deal-new-form.tsx` の `assigned_sales` も同様に Combobox 化(default は `getCurrentProfile()` の id)
  - 「未割当(NULL)」の選択肢を含める
  - 完了状態: 各フォームで担当者欄が text input ではなく user 選択 UI になっており、placeholder 保持の名前も選べる
  - _Requirements: 3.3, 3.7_
  - _Boundary: app/(main)/stores/new/_components/store-new-form.tsx, app/(main)/deals/new/_components/deal-new-form.tsx_
  - _Depends: 7.2_

- [x] 7.4 表示コンポーネントで profile 名 join を反映
  - `app/(main)/stores/_components/stores-table.tsx`、`app/(main)/pipeline/_components/kanban-board.tsx` 等で `assigned_*_user_id` を profile 名に解決して表示
  - 解決ヘルパは `lib/queries/profiles.ts` の `getProfileById` または map 化した `getAllProfiles()` をローカルで使う
  - 完了状態: 一覧 / Kanban の担当者列に表示名が出る、未割当は空表示 or `—`
  - _Requirements: 3.7, 3.8_
  - _Boundary: app/(main)/stores/_components, app/(main)/pipeline/_components_
  - _Depends: 7.3_

- [x] 7.5 `lib/domain/staff.ts` の整理と参照置換
  - `PLANNERS` / `SALES` / `CURRENT_USER` 定数を削除し、`@deprecated` コメントで `lib/queries/profiles.ts` への移行を案内
  - `OPS_MEMBERS` は handoff 関連が user 参照化される別 Issue まで暫定維持(コメントで保留理由を明示)
  - `grep -r "PLANNERS\|SALES\b\|CURRENT_USER" --include="*.ts" --include="*.tsx" .` の全件をリストし、各参照箇所を `getCurrentProfile()` / `getAllProfiles()` に置換、または用途消失で削除
  - 完了状態: `pnpm typecheck` / `pnpm lint` / `pnpm build` が通り、`grep` 結果が `lib/domain/staff.ts` の `OPS_MEMBERS` 定義のみに減る
  - _Requirements: 3.7_
  - _Boundary: lib/domain/staff.ts, リポジトリ全体_
  - _Depends: 7.4_

---

## 8. Migration Phase 2

- [ ] 8.1 旧 text カラム DROP マイグレーション
  - `drizzle/0005_drop_legacy_assignee_text_columns.sql` を作成
  - `stores.assigned_planner` / `stores.assigned_sales` / `deals.assigned_sales` を DROP
  - `store_research_jobs.triggered_by`(text)を DROP し `triggered_by_user_id` を `triggered_by` にリネーム(該当時のみ)
  - 完了状態: ローカル staging DB で `pnpm drizzle-kit migrate` が成功、`SELECT column_name FROM information_schema.columns WHERE table_name='stores'` から旧 2 カラムが消えている
  - _Requirements: 3.6_
  - _Boundary: drizzle/0005_*.sql_
  - _Depends: 7.5, 6.6_

- [ ] 8.2 lib/db/schema.ts から旧カラム定義を除去
  - schema.ts の `assigned_planner` / `assigned_sales` 行を削除し、`triggered_by` を `uuid("triggered_by")` に維持(リネーム後の最終状態)
  - 完了状態: schema.ts と DB の実カラムが完全一致、`pnpm typecheck` 通過
  - _Requirements: 3.6_
  - _Boundary: lib/db/schema.ts_
  - _Depends: 8.1_

---

## 9. リマインダー Cron

- [ ] 9.1 deals-due-soon クエリ
  - `lib/queries/deals-due-soon.ts` に `getDealsDueSoon(mode: 'tomorrow'|'today'): Promise<ReminderBundle[]>` を実装
  - JST 基準で対象日を計算(`Asia/Tokyo` で当日 / 翌日の `YYYY-MM-DD` 文字列)、`assigned_sales_user_id IS NOT NULL` でフィルタ
  - 結果はユーザー単位に集約(`Map<userId, deals[]>`)、profile 情報を join して `ReminderBundle = { profile, deals }` の配列で返す
  - 完了状態: 単体で呼出して期待される対象商談だけが返る、未割当商談は除外される
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.7_
  - _Boundary: lib/queries/deals-due-soon.ts_
  - _Depends: 2.5, 7.1_

- [ ] 9.2 Vercel Cron Route Handler
  - `app/api/cron/deal-reminders/route.ts` で GET ハンドラを実装、`Authorization: Bearer ${CRON_SECRET}` 検証(不一致は 401)
  - クエリ `mode ∈ {tomorrow, today}` を検証(不一致は 400)
  - `getDealsDueSoon(mode)` 結果が 0 件なら早期 return + `{ sent: 0, skipped: 0 }` を返す
  - 1 件以上ならユーザーごとに `deal-reminder` テンプレートを生成し `emailClient.send()` を呼ぶ
  - 個別失敗は error ログのみ(全体は 200)、サマリを JSON で返す
  - 完了状態: `curl -H "Authorization: Bearer xxx" 'http://localhost:3000/api/cron/deal-reminders?mode=tomorrow'` でステータスコード 200 と JSON が返る、`RESEND_API_KEY` 未設定でも noop で 200
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.8, 4.1, 4.2, 4.3_
  - _Boundary: app/api/cron/deal-reminders/route.ts_
  - _Depends: 9.1, 5.4_

- [ ] 9.3 Vercel Cron スケジュール設定
  - `vercel.json` を新規作成、`crons` 配列に `{ path: "/api/cron/deal-reminders?mode=tomorrow", schedule: "0 22 * * *" }`(JST 7:00)と `{ path: ..., mode=today, schedule: "0 23 * * *" }`(JST 8:00)を登録
  - 完了状態: `vercel.json` がリポジトリにコミットされ、Vercel デプロイ時に Cron が登録される(本番運用時に手動確認)
  - _Requirements: 6.1, 6.2, 6.3_
  - _Boundary: vercel.json_
  - _Depends: 9.2_

---

## 10. #14 連携(通知 / ジョブフック)

- [ ] 10.1 notifications.user_id 追加(本仕様の責務)
  - `#14` が `notifications` テーブルを未新設の場合: 6.2 の 0004 マイグレーションに `notifications.user_id uuid REFERENCES profiles(id)` 追加 + `CREATE INDEX idx_notifications_user_id ON notifications(user_id)` を含める
  - `#14` が新設済の場合: 別マイグレーション `drizzle/000X_add_user_id_to_notifications.sql` で `ALTER TABLE notifications ADD COLUMN user_id uuid REFERENCES profiles(id)` + index を追加
  - 完了状態: `notifications.user_id` カラムが DB 上に存在し、`repos.notification.findByUserId(uid)` が動作
  - _Requirements: 7.1, 7.2_
  - _Boundary: drizzle/, lib/db/schema.ts_
  - _Depends: 6.2, 2.5_

- [ ] 10.2 ジョブフック契約と研究ジョブメール送信
  - `lib/jobs/research-worker.ts`(#14 が所有)に対して、本仕様で「`status: 'completed' | 'failed'` 遷移時に email を呼ぶ」フックを挿入
  - フック関数 `sendResearchJobNotification(job, kind)` を `lib/email/index.ts` から提供:
    - `repos.profile.findById(job.triggered_by)` で受信者解決
    - 不明な場合は error ログ + return(Req 5.7)
    - kind に応じて `research-job-completed` / `research-job-failed` テンプレートを使用 → `emailClient.send()`
  - `triggered_by_user_id` (Phase 1 状態) または `triggered_by` (Phase 2 完了後) のいずれを参照するかは #14 と協調、本仕様完了時点では Phase 2 後を前提
  - 完了状態: ローカルでジョブ status を手動で completed / failed に遷移させ、`RESEND_API_KEY` 設定環境でメールが送られる(unset 環境では noop)
  - _Requirements: 5.2, 5.3, 5.7, 4.1, 4.3_
  - _Boundary: lib/email/index.ts, lib/jobs/research-worker.ts_
  - _Depends: 5.3, 2.5, 6.2_

---

## 11. Validation: テスト・整合確認

- [ ] 11.1 (P) Email クライアントの Vitest ユニットテスト
  - `lib/email/__tests__/client.test.ts` を作成、4 ケースをテスト:
    - `RESEND_API_KEY` 未設定 → `kind: 'noop'`
    - `to` が `@local.invalid` → `kind: 'noop'`
    - 件名プレフィックス `[fw-sales] ` 付与
    - Resend 失敗時 `kind: 'failed'` で throw しない
  - 完了状態: `pnpm test lib/email/__tests__/client.test.ts` が 4 件 pass
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 8.3_
  - _Boundary: lib/email/__tests__/client.test.ts_
  - _Depends: 5.1_

- [ ] 11.2 (P) バックフィルスクリプトのユニットテスト
  - `scripts/__tests__/backfill-assignees.test.ts` を作成、3 ケース:
    - 既存 profile マッチ優先(text 値が `display_name` と一致 → 既存 id を選択)
    - 不一致は placeholder 生成(`@local.invalid` / `role='placeholder'` を確認)
    - dry-run で UPDATE 文が発行されない
  - 完了状態: `pnpm test scripts/__tests__/backfill-assignees.test.ts` が 3 件 pass
  - _Requirements: 3.4, 3.5_
  - _Boundary: scripts/__tests__/backfill-assignees.test.ts_
  - _Depends: 6.6_

- [ ] 11.3 (P) deals-due-soon クエリのユニットテスト
  - `lib/queries/__tests__/deals-due-soon.test.ts` を作成、4 ケース:
    - `mode='tomorrow'` で翌日 JST のみ抽出
    - `mode='today'` で当日 JST のみ抽出
    - 担当者 NULL の商談は除外
    - ユーザーごとに集約される(2 名 × 各 2 件 → 2 bundle)
  - 完了状態: 4 件 pass
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.7_
  - _Boundary: lib/queries/__tests__/deals-due-soon.test.ts_
  - _Depends: 9.1_

- [ ] 11.4 (P) ProfileRepository のユニットテスト
  - `lib/db/__tests__/profile-repository.test.ts`、`lib/mock/__tests__/profile.test.ts` を作成
  - 3 ケース: `findByDisplayName` 完全一致 / `createPlaceholder` の email 形式 / `findManyByIds` で空配列入力時の挙動
  - 完了状態: 両ファイルで合計 6 件 pass
  - _Requirements: 2.1, 2.5, 3.4, 3.5_
  - _Boundary: lib/db/__tests__/profile-repository.test.ts, lib/mock/__tests__/profile.test.ts_
  - _Depends: 2.2, 2.3_

- [ ] 11.5 README に運用注意を追記
  - 自由登録のリスク(Google アカウント所有者なら誰でもサインイン可能、別 Issue で対応予定)
  - 環境変数 8 件の用途と未設定時の挙動
  - Cron 起動方法と CRON_SECRET の設定
  - Mock 経路の認証バイパス挙動(`USE_MOCK_DB=true` 時に固定 `PLACEHOLDER_DEV_PROFILE_ID` でログイン状態として動作)
  - 完了状態: README.md に新セクション「Authentication & Notifications」または既存セクションへの追記が存在する
  - _Requirements: 2.4, 8.1, 8.2, 8.3_
  - _Boundary: README.md_

- [ ] 11.6 統合検証(手動 E2E チェックリスト)
  - 以下を `docs/auth-and-notifications-e2e.md` または `.kiro/specs/auth-and-notifications/manual-e2e-checklist.md` として追記し、ステージングで通過確認:
    1. 未ログインで `/dashboard` → `/login` リダイレクト
    2. `/login` で「Google でサインイン」→ Google 同意 → `/dashboard` 復帰、ヘッダーにアバター表示
    3. サインアウト → `/login` へ戻る
    4. 店舗 / 商談新規登録フォームで担当者欄が user 選択 UI
    5. `pnpm tsx scripts/backfill-assignees.ts --dry-run` がマッピング表を出す
    6. apply 後、新カラムが埋まっており Phase 2 適用後に旧 text カラムが消えている
    7. 商談 `date` を翌日に設定 → 翌朝 7:00 JST にリマインダーメール受信(または curl で疑似発火)
    8. `RESEND_API_KEY` を空にして起動 → 認証 / 主要機能は動作 / メール送信は warn のみ
    9. `pnpm typecheck && pnpm lint && pnpm build && pnpm test` 全通過
  - 完了状態: 9 項目すべてに ✅ が付き、文書として残る
  - _Requirements: 全要件の統合検証_
  - _Boundary: docs / .kiro/specs/auth-and-notifications/_
  - _Depends: 4.6, 7.5, 8.2, 9.3, 10.2, 11.1, 11.2, 11.3, 11.4_

---

## Coverage Summary

| 要件 | 担当タスク |
|---|---|
| 1.1 | 4.1, 4.6 |
| 1.2 | 1.1, 4.2 |
| 1.3 | 3.1, 4.3 |
| 1.4 | 4.2, 4.3 |
| 1.5 | 2.6, 3.1, 4.5, 4.6 |
| 1.6 | 3.1, 4.4, 4.5 |
| 1.7 | 4.2 |
| 2.1 | 1.3, 1.4, 2.1, 2.2, 2.5, 4.3, 6.1, 6.2, 6.3, 11.4 |
| 2.2 | 6.2 |
| 2.3 | 1.3, 6.2 |
| 2.4 | 11.5 |
| 2.5 | 1.4, 2.1, 2.2, 2.3, 11.4 |
| 3.1 | 6.1, 6.3, 6.4, 6.5, 7.1 |
| 3.2 | 6.1, 6.3, 6.4, 6.5, 7.1 |
| 3.3 | 7.1, 7.2, 7.3 |
| 3.4 | 2.1, 2.2, 6.6, 11.2, 11.4 |
| 3.5 | 2.1, 2.2, 6.6, 11.2, 11.4 |
| 3.6 | 8.1, 8.2 |
| 3.7 | 2.1, 2.6, 7.2, 7.3, 7.4, 7.5 |
| 3.8 | 6.4, 6.5, 7.2, 7.4 |
| 4.1 | 1.1, 5.1, 9.2, 10.2 |
| 4.2 | 5.1, 9.2, 11.1 |
| 4.3 | 5.1, 9.2, 10.2, 11.1 |
| 4.4 | 5.1, 5.2, 11.1 |
| 5.1 | 6.1, 6.6 |
| 5.2 | 10.2 |
| 5.3 | 10.2 |
| 5.4 | 5.3, 11.1(件名プレフィックス含意) |
| 5.5 | 5.3 |
| 5.6 | 5.3 |
| 5.7 | 10.2 |
| 6.1 | 9.1, 9.2, 9.3, 11.3 |
| 6.2 | 9.1, 9.2, 9.3, 11.3 |
| 6.3 | 9.1, 9.2, 9.3, 11.3 |
| 6.4 | 9.1, 9.2, 11.3 |
| 6.5 | 5.4, 9.2 |
| 6.6 | 5.4, 9.2 |
| 6.7 | 9.1, 11.3 |
| 6.8 | 9.2 |
| 7.1 | 1.3, 1.4, 2.4, 2.5, 6.1, 10.1 |
| 7.2 | 2.4, 10.1 |
| 7.3 | 2.4 |
| 8.1 | 1.2, 11.5 |
| 8.2 | 1.2, 3.1, 11.5 |
| 8.3 | 1.2, 5.1, 11.1, 11.5 |

全 45 件の要件 ID がいずれかのタスクに割り当て済。

## 並列実行ガイド

`(P)` を付与したタスクは独立 boundary を持ち、`_Depends:_` の前提を満たした上で同時実行可能。主要な並列セット:

- **Foundation 並列**: 1.4(独立した型ファイル)
- **Data Layer 並列**: 2.2 / 2.3(同 interface に依存するが boundary 別)
- **Auth Adapter 並列**: 3.1 / 3.2 / 3.3(独立ファイル、共通の依存なし)
- **`/login` UI と Callback 並列**: 4.2 / 4.3(別ファイル、auth adapter 経由でのみ接続)
- **Email Templates 並列**: 5.2 完了後に 5.3 / 5.4
- **Validation 並列**: 11.1 / 11.2 / 11.3 / 11.4(独立テストファイル)

---

## Implementation Notes

- **Phase 2 (2026-05-10)**: Task 2.2 / 2.4 で `lib/db/schema.ts` に `profiles` / `notifications` テーブル定義を**先行追加**した(本来 Task 6.1 / 10.1 の責務だが、`lib/db/profile-repository.ts` / `lib/db/notification-repository.ts` の Drizzle 実装が schema を参照するため依存順を満たすために前倒し)。Task 6.1 / 10.1 は **assigned_*_user_id 列追加 / FK 制約** のみが残責務となる。
- **Phase 2 (2026-05-10)**: `DbSnapshot` 型に `profiles?` / `notifications?` を **optional** で追加。`app/api/export/route.ts` / `lib/actions/data-actions.ts` の DB-mode export パスは将来タスクで profiles / notifications を含める形に拡張する。Mock 経路は `snapshotMockDb()` で完全に含める。
- **Phase 2 (2026-05-10)**: `PLACEHOLDER_DEV_PROFILE_ID = "00000000-0000-0000-0000-000000000001"` を `lib/mock/seed.ts` に定数定義。Task 3.1 / 3.3 でこれを import して Mock セッションバイパスに利用する。
- **Phase 3 (2026-05-10)**: `@supabase/ssr` v0.5.2 の `setAll` callback の引数 `cookiesToSet` は型推論が効かないため明示的に `{ name: string; value: string; options: CookieOptions }[]` でアノテートする(`tsc strict` 環境)。`CookieOptions` は `@supabase/ssr` から re-export されている。
- **Phase 4 (2026-05-10)**: 当初 `UserMenu` を `@base-ui/react/menu` ベースで実装したが、プロジェクト内で base-ui の実用例がなかったため useState + click-outside ベースのシンプルなドロップダウンに置換。本仕様の要件は「avatar + sign-out が動作する」のみなので過剰依存を避けた。
- **Phase 4 (2026-05-10)**: `pnpm lint` が `.claude/worktrees/feat+pipeline-sales-filter-5/.next/` 配下の build 成果物 10883 件を拾う既存問題を確認(eslint.config.mjs の `globalIgnores([".next/**"])` がトップレベルの `.next/` のみマッチして worktree 配下を無視できていない)。本仕様のコード自体は lint クリーン、修正は別 Issue 推奨(globalIgnores に `**/.next/**` または `.claude/**` を追加)。
- **Phase 5 (2026-05-10)**: メールテンプレートは React JSX を `react-dom/server` の `renderToStaticMarkup` で HTML 化(D-3 自前テンプレート方針)。共通レイアウトは `lib/email/templates/_layout.tsx` に集約、各テンプレートは `EmailLayout` を import + `renderEmail()` ヘルパで HTML 文字列を生成。各テンプレートは `text` 版も同時生成し Resend に両方渡す(プレーンテキストフォールバック対応)。`emailClient.send()` の `to` が `@local.invalid` で終わるケースは placeholder 保護で no-op 返却(誤配信防止)。
- **Phase 6 (2026-05-11)**: 0004 マイグレーションは `pnpm drizzle-kit generate --name=add_profiles_and_assignee_user_id` で初期 SQL を生成したのち、cross-schema FK (`profiles.id → auth.users.id ON DELETE CASCADE`)、`idx_notifications_user_id` インデックス、`handle_new_user()` 関数 + `on_auth_user_created` trigger (SECURITY DEFINER) を**手動追記**した。drizzle-kit は cross-schema FK / trigger / function を表現できないため、生成 SQL に raw SQL を append する運用が必須(以降のマイグレーションでも同方針を踏襲する)。
- **Phase 6 (2026-05-11)**: `store_research_jobs.triggered_by` のカラム改名は #14 が当該テーブルを未新設のため**本 Phase ではスコープ外**とし、`scripts/backfill-assignees.ts` も `stores` / `deals` のみを処理。Phase 8 で #14 進捗に応じて triggered_by の処理を追加する想定。
- **Phase 6 (2026-05-11)**: Phase 7.1 でカラムを最終形(`assigned_*_user_id` を必須・旧 text を削除)に切替えるまで `types/store.ts` / `types/deal.ts` の `assigned_*_user_id` を **optional (`?: string | null`)** に保つ。これにより既存コード(旧 text フィールドを参照する serializer / Mock / 表示コンポーネント)を破壊せず段階移行できる。Phase 7.1 で `?` を外して必須化する手順を tasks.md に明記。
- **Phase 6 (2026-05-11)**: タスク 6.4 / 6.5 は「Mock / DB リポジトリを新スキーマに追従」だが、`stores.findAll()` 等は `select(stores)` ベースの素通しで、追加カラムは自動的に row に乗る。Mock 側も `Map<string, Store>` を返すだけで filter / sort ロジックは旧 text を参照していなかったため、**コード変更は発生しなかった**(SEED 更新と型 optional 追加のみで担保)。Phase 7.x で UI 側 filter / Server Action 側 readNullableString を反映する際に初めて差分が出る想定。
- **Phase 6 (2026-05-11)**: `scripts/backfill-assignees.ts` の `slugify()` は日本語表示名(漢字 / カナ)を `[^a-z0-9-]` で `-` 置換するため、純日本語表示名は空文字に縮退する。空 fallback として `unknown-${Date.now()}` を返し placeholder email 衝突を回避(同名 placeholder は profileCache で吸収)。dry-run は読取専用のため `dbProfileRepo.createPlaceholder` を呼ばず、別 `dryCache` 上で「(would create placeholder for ...)」のプレビュー文字列を表示する設計とした。
- **Phase 7 (2026-05-16)**: `types/store.ts` / `types/deal.ts` の旧 `assigned_planner` / `assigned_sales` (text) は **@deprecated コメント付きで残置**(Phase 8 で削除)、`assigned_*_user_id` を **必須 (`string | null`)** に格上げ。Server Action 側 `buildStoreInput()` / `createDealAction()` で旧 text 列は空文字でハードコードして書込まない方式に切替えた。これにより `repos.store.update()` / `repos.deal.create()` の呼び出し側を破壊せず段階移行できる。
- **Phase 7 (2026-05-16)**: 担当者 UI は **profile 名 Combobox** 化済(store/new・store/edit・store/[id] 基本情報カード・deal/new・research/[storeId]・pipeline-filters)。Parent RSC で `getAllProfiles({excludePlaceholders: false})` を呼び profiles を props 経由で Client Component に渡す方式。default 値は `getCurrentProfile()` の id を採用(deal は store の `assigned_sales_user_id` を最優先)。
- **Phase 7 (2026-05-16)**: `StoreFilter.sales` は Phase 7 で **profile.id (uuid) 参照に切替**。`lib/db/store-repository.ts` の WHERE 句 / `lib/mock/store.ts` の `matches()` を `assigned_sales_user_id` 比較に置換。PR #24 (`feat/pipeline-sales-filter-5`) は旧 text 比較で実装されていたが、本 Phase で同セマンティクスを user_id に統一(URL クエリ `?sales=<uuid>` 仕様に変更、旧 `?sales=渡部` URL は失効)。
- **Phase 7 (2026-05-16)**: `lib/actions/_helpers.ts` に `readNullableString()` を新設(`""` → `null` 化)、担当者 user_id の未割当を `null` で表現する規約に統一。`validateAssignedUserIds()` を `store-actions.ts` に追加し、`null` でない uuid が `profiles.id` に存在することを `repos.profile.findById()` で検証 → 不正値は `failure(...)` で早期返却(FK 違反の Server Action 層 ガード)。
- **Phase 7 (2026-05-16)**: `lib/domain/staff.ts` から `PLANNERS` / `SALES` / `CURRENT_USER` を**完全撤廃**し OPS_MEMBERS のみ残置(handoff 関連 user 参照化は別 Issue)。`components/layout/sidebar.tsx` は `currentProfile?: Profile` props を `SidebarShell` (in `app/(main)/layout.tsx`) から受け取る形に変更し、`getCurrentProfile()` 経由で動的にユーザ情報を表示。

---

## Out of Boundary 注記

- `notifications` テーブル本体 / 通知ベル UI: #14 の責務。本仕様は 10.1 で `user_id` カラム追加のみを担う
- `store_research_jobs` テーブル本体 / ジョブワーカー本体: #14 の責務。本仕様は `triggered_by` カラム型変換 (6.2) と email フック (10.2) のみ
- `handoffs.ops_assignee` の user 参照化: 別 Issue。`OPS_MEMBERS` は本仕様で暫定維持(7.5)
- 店舗詳細画面: #15 の責務。リマインダー本文の店舗詳細リンクは #15 公開後の URL を前提
- placeholder profile を実ユーザーへマージする Admin UI: 将来 Issue
- `role='admin'` を用いた権限分岐: 将来 Issue
- メール / パスワード認証 / 招待制 / ドメイン制限: 将来 Issue
