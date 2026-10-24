# ローカルE2E環境

データを保持しながら手動で画面・DB操作を検証する場合は、[ローカル検証環境の起動手順](environment-separation.md#ローカル検証の起動)の`pnpm dev:local`／`pnpm local:open`を利用してください。この環境はE2E専用DBから独立しています。

このプロジェクトのE2Eは、Apple Container上のE2E専用PostgreSQLとPlaywrightを使います。本番Supabaseへ接続せず、既存のDrizzle migrationとseedデータをローカルDBへ適用してからテストを実行します。

Supabase CLIの`supabase start`はDocker Engine API（`/var/run/docker.sock`）を必要とします。Appleの`container` CLIやDocker互換shimはこのAPIを提供しないため、E2EではSupabase CLIを使わず、PostgreSQLコンテナを直接起動します。Docker Desktopも不要です。

## 初回セットアップ

Apple Containerをインストールして起動できる状態にします。設定は既定値のままで動きます。値を変えたいときだけ、リポジトリ直下に`.env.e2e`を作って[環境変数](#環境変数)を書きます（`.env.e2e`は`.gitignore`で除外しています）。

```bash
container --version
container system start
pnpm install
pnpm e2e:install
pnpm e2e
```

インストール済みのChromium系ブラウザ（Aside、Google Chromeなど）で実行したい場合は、`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`に実行ファイルのパスを設定します。この場合`pnpm e2e:install`は不要です。CI（`CI`が設定された環境）ではこの変数を無視し、常にPlaywright付属のChromiumを使います。

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/Applications/Aside.app/Contents/MacOS/Aside pnpm e2e
```

Playwrightが想定する版より古いブラウザでは、製品に問題が無くても落ちるテストがあります。たとえばChrome for Testing 148では`custom-select.spec.ts`のフォーカスの確認が落ち、Playwright 1.63付属のChromium 153では通ります。結果がCIと食い違ったら、付属のChromium（`pnpm e2e:install`）で流し直してください。

`pnpm e2e`は次を自動実行します。

1. `container system start`でApple Containerを起動
2. `fw-sales-e2e-postgres`（`E2E_DB_CONTAINER`で変更可）という名前のPostgreSQLコンテナを起動し、Apple Containerの内部IPへ接続
3. DB接続を待機
4. `pnpm db:migrate`で`drizzle/`のmigrationを適用
5. `pnpm seed`で再現可能なseedデータを投入
6. E2E用のprofileとテナントの所属を冪等に作り直す。通知やレビュー待ちの調査結果など、specが前提にする状態は各specの`beforeAll`で作り直す（[retryしても同じ状態から始める](#retryしても同じ状態から始める)）
7. Next.js開発サーバーを起動し、Chromium E2Eを実行

E2Eの再実行時は、同名のPostgreSQLコンテナを削除してから作り直します。アプリの通常開発用DBや本番Supabaseには影響しません。

`E2E_DATABASE_URL`を指定したときは、1と2を行わず、そのPostgreSQLを使います（[CIでの実行](#ciでの実行)）。

## 環境変数

`pnpm e2e:setup`・`pnpm e2e:server`・Playwrightの起動はすべて同じ変数を読むため、`pnpm e2e`の前に指定するか`.env.e2e`に書けば一貫して切り替わります。

| 変数 | 既定値 | 用途 |
|---|---|---|
| `E2E_DB_CONTAINER` | `fw-sales-e2e-postgres` | E2E用PostgreSQLのコンテナ名。英数字で始まり、英数字と`_.-`だけの63文字以内 |
| `E2E_PORT` | `3100` | Next.js開発サーバーのポート |
| `E2E_DATABASE_URL` | なし | 指定すると、コンテナを起動せずにこのPostgreSQLを使う。準備処理がmigrationとseedを入れ直すため、localhostとプライベートIP以外は接続する前に拒否する |
| `E2E_TEST_EMAIL` | `e2e@example.test` | E2Eユーザーのメールアドレス |
| `E2E_TEST_SECRET` | `local-e2e-only` | `/api/e2e/login`が照合する`x-e2e-secret`ヘッダーの値 |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` | なし | 付属のChromiumの代わりに使うブラウザ。CIでは無視する |

## 複数の作業ツリーで並行して実行する

コンテナ名と開発サーバーのポートは既定で固定です。別の作業ツリー（worktree）で`pnpm e2e`を同時に実行すると、後から始めた側が先に実行中のDBコンテナを削除して作り直すため、先の実行が壊れます。並行して実行するときは、作業ごとにコンテナ名とポートを分けてください。

```bash
E2E_DB_CONTAINER=fw-sales-e2e-postgres-297 E2E_PORT=3297 pnpm e2e
```

終わったら自分のコンテナだけを削除します。

```bash
container delete --force fw-sales-e2e-postgres-297
```

## CIでの実行

`.github/workflows/e2e.yml`が、PRとmainへのpushで`pnpm e2e`を実行します（#386）。Apple Containerの代わりにGitHub Actionsのservice container（`postgres:15-alpine`）を立て、`E2E_DATABASE_URL`で渡します。

- ブラウザはPlaywright付属のChromium（Headless Shell）です。`playwright.config.ts`は`CI`を見て、retries 2・line reporter・`test.only`の禁止に切り替えます。
- 失敗した試行のtraceは、artifact `e2e-test-results`に7日間残ります。retryで通ったテストのtraceも含みます。ダウンロードして`pnpm exec playwright show-trace <trace.zip>`で開きます。
- secretは使いません。forkからのPRでもそのまま実行されます。
- まだrequired checkにはしていません。

手元でCIと同じ経路を試すときは、PostgreSQLを自分で起動して`E2E_DATABASE_URL`で渡します。

```bash
container run --detach --rm --name fw-sales-e2e-ci --env POSTGRES_PASSWORD=postgres postgres:15-alpine
container list   # fw-sales-e2e-ci の IP を確かめる（例: 192.168.64.20）
E2E_DATABASE_URL=postgres://postgres:postgres@192.168.64.20:5432/postgres E2E_PORT=3297 pnpm e2e
container delete --force fw-sales-e2e-ci
```

## retryしても同じ状態から始める

CIでは、落ちたテストを2回までretryします。serialのspecは1件落ちると、そのファイルのテストを先頭からまとめてretryします。retryは新しいworkerで`beforeAll`から始まりますが、準備処理（`pnpm e2e:setup`）はretryの前には走りません（#390）。

- specが前提にする状態（通知、調査結果、店舗名・業態、営業記録など）は、そのspecの`beforeAll`で作り直します。準備処理、seed、テスト末尾の「元に戻す」には頼りません。テストの途中で落ちると、「元に戻す」まで進まないためです。
- SQLで値を作り直したら、`e2e/support/fresh-cache.ts`の`refreshServerCache`で、specが開くページを読み直させます。店舗や通知は`'use cache'`で読むので、SQLで直しただけでは前の試行の値が画面に残ります。devサーバーは`Cache-Control: no-cache`の要求のときだけ、キャッシュを読まずに作り直します。
- 確かめるときは、状態を変えた直後に`if (test.info().retry === 0) throw new Error("negative control")`を一時的に入れ、`pnpm e2e --reporter=line --retries 1 <spec>`を流します。retry #1で緑になれば、retryしても同じ状態から始められています（結果はflakyと表示されます）。

## 認証

Google OAuthやSupabase AuthをE2Eの外部依存にしないため、`/api/e2e/login`で開発時限定のE2EセッションCookieを発行します。`NODE_ENV=development`かつ`E2E_TEST_MODE=1`の場合だけ有効で、`x-e2e-secret`ヘッダーが一致しない場合は404を返します。

この認証バイパスはE2E専用です。通常の開発・本番では従来どおりSupabase Authを利用します。そのため、Google OAuthやSupabase Auth自体の動作確認は、別途ステージング環境などで行ってください。

ステージングでの実認証確認は、[auth-and-notifications 手動E2Eチェックリスト](auth-and-notifications-e2e.md)を使用します。特に次を確認してください。

- Google OAuth同意画面への遷移
- `/auth/callback`でのセッション確立と指定画面への復帰
- ヘッダー／サイドバーのProfile表示
- サインアウト後のセッション破棄とログイン画面への復帰

ステージングのSupabase ProjectとGoogle OAuth Clientは、ローカルE2Eのダミー環境変数やE2E認証Cookieと共有しないでください。

生成された認証状態は`playwright/.auth/user.json`に保存されますが、`.gitignore`で除外しています。認証Cookieを含むため、コミットしてはいけません。

## テストの追加

認証済みテストは`e2e/*.spec.ts`へ追加します。認証不要のテストでは、既存の`unauthenticated.spec.ts`と同じく`storageState`を空にします。

UIモードは次で起動できます。

```bash
pnpm e2e:ui
```

PostgreSQLコンテナを手動で停止する場合は、E2E専用コンテナだけを対象にしてください。`E2E_DB_CONTAINER`を指定した場合はその名前を使います。

```bash
container delete --force fw-sales-e2e-postgres
```

## Docker互換shimについて

`docker-for-apple-container`などのDocker互換shimを導入していても、Supabase CLIが必要とするDocker Engine APIを提供しないため、このE2E構成では使用しません。既にインストール済みのshimを削除する必要もありません。
