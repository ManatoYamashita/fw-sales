# ローカルE2E環境

このプロジェクトのE2Eは、Apple Container上のE2E専用PostgreSQLとPlaywrightを使います。本番Supabaseへ接続せず、既存のDrizzle migrationとseedデータをローカルDBへ適用してからテストを実行します。

Supabase CLIの`supabase start`はDocker Engine API（`/var/run/docker.sock`）を必要とします。Appleの`container` CLIやDocker互換shimはこのAPIを提供しないため、E2EではSupabase CLIを使わず、PostgreSQLコンテナを直接起動します。Docker Desktopも不要です。

## 初回セットアップ

Apple Containerをインストールして起動できる状態にし、必要なら`.env.e2e.example`を`.env.e2e`へコピーして値を変更します。

```bash
container --version
container system start
cp .env.e2e.example .env.e2e
pnpm install
pnpm e2e:install
pnpm e2e
```

`pnpm e2e`は次を自動実行します。

1. `container system start`でApple Containerを起動
2. `fw-sales-e2e-postgres`という名前のPostgreSQLコンテナを起動し、Apple Containerの内部IPへ接続
3. DB接続を待機
4. `pnpm db:migrate`で`drizzle/`のmigrationを適用
5. `pnpm seed`で再現可能なseedデータを投入
6. E2E用profileを冪等に作成
7. Next.js開発サーバーを起動し、Chromium E2Eを実行

E2Eの再実行時は、同名のPostgreSQLコンテナを削除してから作り直します。アプリの通常開発用DBや本番Supabaseには影響しません。

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

PostgreSQLコンテナを手動で停止する場合は、E2E専用コンテナだけを対象にしてください。

```bash
container delete --force fw-sales-e2e-postgres
```

## Docker互換shimについて

`docker-for-apple-container`などのDocker互換shimを導入していても、Supabase CLIが必要とするDocker Engine APIを提供しないため、このE2E構成では使用しません。既にインストール済みのshimを削除する必要もありません。
