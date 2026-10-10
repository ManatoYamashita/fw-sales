# dev／prdとローカル検証環境

Issue: [#46](https://github.com/ManatoYamashita/fw-sales/issues/46)

## 採用方針

Supabaseはdev／prdでプロジェクトを分離し、Vercelは当面1プロジェクトの環境別設定を使います。

| 実行環境 | DB・認証 | 対応状態 |
| --- | --- | --- |
| ローカル検証（`pnpm dev:local`） | 専用PostgreSQL＋ローカルテストユーザー | 本ドキュメントの手順で起動 |
| 通常のローカル開発／Vercel Development | dev Supabase | DB／Service RoleのConfig登録待ち。Secretの値は再取得不可 |
| Vercel Preview | dev Supabase | 既存stagingのSecretを共有Previewへ移行 |
| Vercel Production | prd Supabase | 既存本番を継続 |

prdは`firstweb_sales_tools`（`bqllbsiahnikgerckwoj`）、devは再開済みの`fw-sales-staging`（`llohmzwfqgcrvusxabcb`）です。Vercelプロジェクト自体の分離とSupabase Branchingは初期対応に含めません。

通常の`pnpm dev`やDB運用コマンドは`.env.local`を使います。本変更では本番DBが残っている設定を起動前に拒否します。Developmentの接続情報を揃えるまでは、画面・DB操作の検証に以下の専用コマンドを使ってください。

## ローカル検証の起動

Apple Containerとpnpmが必要です。Docker DesktopやSupabase CLIは使いません。

```bash
# 専用DBを作成／再開し、migrationを適用してアプリを起動
pnpm dev:local

# 別ターミナルで、テストユーザーとしてブラウザを開く
pnpm local:open
```

URLは`http://127.0.0.1:3200/stores`です。ユーザーは`local@example.test`、表示名は`Local Test User`、権限は`admin`です。Googleログインの代わりに既存の開発時限定E2E認証を使います。

`local:open`はPlaywright付属Chromium、Google Chrome、Asideの順にインストール済みブラウザを探します。専用プロファイルを使うため、通常利用しているブラウザのCookieと混ざりません。ブラウザがなければ`pnpm e2e:install`を実行してください。

ポートを変更する場合は、Git管理対象外の`.env.local-preview`へ次を設定します。起動とブラウザを開くコマンドが同じ設定を読みます。

```dotenv
LOCAL_PREVIEW_PORT=3210
```

## データと接続先

- コンテナ名は`fw-sales-local-postgres`です。既存E2Eの`fw-sales-e2e-postgres`と独立しています。
- 既存Drizzle migrationを適用し、店舗データが空の場合だけ既存seedを投入します。再起動時に既存店舗を上書きしません。
- DB接続先は専用コンテナの内部IPから生成します。`DATABASE_URL`や`E2E_DATABASE_URL`による接続先の指定は受け付けません。
- DB・Supabase Authの環境変数は子プロセスへ明示的に渡します。Next.jsとDBコマンドでは、この設定が`.env.local`より優先されます。
- Gemini、Places、Maps、Google OAuth、Vercel OIDC、Cronのキーは空にして、本番の外部サービス設定を継承しません。そのためAI生成・エリア検索など外部APIを使う機能はこの環境の検証対象外です。
- 管理者の全削除・seedリセットは専用ローカルDBで利用できます。
- `.local-preview/`にはローカル認証Secretと専用ブラウザのデータが保存されます。Git管理対象外です。

Google OAuth・Supabase Authそのものとサインアウトの検証はdev Supabaseで行います。このローカル環境での画面・DB操作確認を、実認証の確認済みとして扱わないでください。

## 状態確認・停止

```bash
# アプリを起動せず、DBだけ準備
pnpm local:setup

# DBの稼働状態、店舗・商談・引き継ぎの件数、テストユーザーの権限を確認
pnpm local:status

# アプリは起動ターミナルでCtrl+C、専用ブラウザはウィンドウを閉じて終了
# その後にDBを停止（データは保持）
pnpm local:stop
```

`pnpm dev:local`と通常開発／E2EのNext.jsサーバーは同じ`.next`を使うため、同一チェックアウトで同時起動しません。切り替える場合は先に起動中のサーバーを終了してください。

## dev／prdを分離する際のルール

1. DBとAuthを同じ環境へセットで切り替えます。Supabase URL、公開キー、Service Role Key、DB接続URLを個別に混在させません。
2. 本番のユーザーや営業データをそのままdevへコピーしません。テストユーザーとseedを使い、必要なデータだけ匿名化します。
3. Vercel Development／Previewにはdev、Productionにはprdの設定を登録します。`NEXT_PUBLIC_*`を変更した場合は再ビルドします。
4. Google側には各Supabaseの`/auth/v1/callback`、Supabase側にはアプリの`/auth/callback`を含む許可URLを登録します。
5. DB変更はdevで検証後にprdへ適用します。本変更の`migrate.yml`は、同一コミットをPreview環境のdev DBで適用・検証した後、mainのpushに限りProduction環境のprd DBへ適用します。手動実行はmainを選択した場合のdevのみです。featureブランチからの実行はスキップします。
6. 環境名だけで接続先を判断せず、実際のSupabaseプロジェクト・DB接続先を確認します。接続情報の値をログやGitへ記録しません。

## クラウド設定と残作業（2026-10-10）

- devは`INACTIVE`から`ACTIVE_HEALTHY`へ復旧しました。復旧中の一時的な空クエリ結果を初期状態と扱わず、起動完了後に再確認しました。
- 既存の29件のDrizzle来歴とGoogle認証ユーザー1名を保持し、0029・0030・0031をdevへ適用しました。店舗5件・商談2件・引き継ぎ1件の既存seedを投入しました。本番からのコピーは行っていません。
- DBパスワードが取得できないため、初期復旧は管理APIで既存Drizzle SQLと対応するSHA-256／`created_at`を同じトランザクションへ入れて適用しました。管理API側の復旧記録はSupabase履歴にも残ります。以後のmigrationの正本は引き続きDrizzleです。履歴の改行差以外の不一致は拒否します。
- 0031は全10テーブルのRLSを有効にし、`anon`／`authenticated`のテーブル権限を撤回します。`handle_new_user`は非公開の`private`へ移動します。アプリはowner／BYPASSRLSのDrizzle接続を使い、Authのプロフィール生成triggerも保持します。0031はprdへ未適用です。
- Vercelの既存staging用`DATABASE_URL`／`SUPABASE_SERVICE_ROLE_KEY`は値を読み出さず、特定ブランチから共有Previewへスコープを変更しました。Auth URLと公開キーはdevへ揃え、Productionの既存接続値は保持しました。
- 旧Preview／DevelopmentのDB・Service Role値は空にし、`ISSUE46_RETIRED_*`へ改名しています。Vercelの接続ツールに削除機能がないため、空の行だけが残っています。ダッシュボードで削除できます。
- Vercel Secret（`sensitive`）は読み戻しやConfig（`encrypted`）への変更ができず、Developmentでは使えません。**DevelopmentのDB URL／Service Role KeyとGitHub Preview Secretは、Supabaseへアクセスできる管理者が取得・登録する必要があります。** チャットやIssueへ値を貼りません。
- devのGoogle providerが有効で、新しいPreview画面からdev Supabase callbackへ向くことを確認しました。Google認証により新しいdevユーザーとプロフィールが作成され、プロフィール生成triggerも動作しています。devテスト用に作成したユーザーをadminにしました。既存ユーザーの権限は保持しています。
- devのSite URLは旧stagingブランチを参照しており、新しいPreviewが許可されていないため旧URLへ戻ります。固定URL `https://fw-sales-dev-shinsotsu-gourmet.vercel.app` を用意しました。SupabaseのSite URL／redirect許可を修正してから、アプリへのログイン完了・サインアウト・UI操作を検証します。
- Vercel環境変数のupsertでは、ターゲットが重なる既存行が残る場合があります。キー・対象環境・ブランチごとの行を確認し、既存IDを指定して修正します。切替後は実際のGoogle callbackをブラウザで検証します。

### Developmentの設定

Vercel Developmentには`APP_ENV=dev`とdevのDB／Auth 4項目、`NEXT_PUBLIC_APP_URL=http://localhost:3000`をセットで登録します。`pnpm env:check`で確認してから`pnpm dev`を起動してください。DB URL／Service Roleが未登録の状態では通常開発を起動しません。

### 誤接続ガード

`lib/environment-isolation.mjs`を、通常開発の事前チェック、Next.jsのサーバー初期化、DBクライアント生成、Drizzle CLIから呼びます。`NODE_ENV=production`でもVercel Previewの接続先はdevです。DBの実ホスト・ユーザー名、Auth URL、Legacy JWTのproject refとroleを照合し、秘密値をエラーへ出しません。ローカルテスト認証でもクラウドDBへ接続できません。

明示的な本番DBの運用は、実行シェルに`APP_ENV=prd`を指定し、本番用接続情報を別途渡します。通常のローカル開発にこの値を保存しません。

### migration・keepalive

- GitHub Environment `Preview`の`DATABASE_URL`はdev、`Production`はprdへ限定します。repository-levelの本番SecretをPreviewの代替として使いません。環境Secretが未登録の場合、devの接続ガードが本番へのfallbackを拒否します。
- `migrate.yml`は`db:check-target`、適用、`db:verify-hashes`、`db:verify-fks`をdevで完了してからprdへ進みます。ワークフローの同時実行を抑止します。mainへのマージ前に両環境のSecret登録を確認してください。
- 日次keepaliveは同じGitHub Environmentsでdev／prdへ別々に実行します。Vercel CronはProductionのみであり、devの代替にはなりません。`CRON_SECRET`を本番からdevへコピーしません。
- Windowsで適用したDrizzle SQLはCRLFのため、LFのCIとハッシュが異なります。検証処理は改行コードだけの差を照合し、SQL変更・改行追加・未適用を引き続き検知します。既存DBの来歴を書き換えません。

### Google OAuth

Google Consoleのredirect URIは`https://llohmzwfqgcrvusxabcb.supabase.co/auth/v1/callback`、Supabase側はlocalhostとdev Previewの`/auth/callback`を許可します。ProductionのGoogle callback／Site URLは保持します。Previewを広く許可する場合は対象Vercelチーム・プロジェクトの範囲に限定し、任意の`vercel.app`へ広げません。

旧Auth Runbookは初回リリースの履歴です。現在の環境設定・migrationは本ドキュメントと`migrate.yml`を参照してください。
