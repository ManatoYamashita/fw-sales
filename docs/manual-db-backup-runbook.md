# 本番DBの手動バックアップと復元確認（Supabase Freeプラン）

Issue: [#384](https://github.com/ManatoYamashita/fw-sales/issues/384)

Supabaseの組織はFreeプランで、自動バックアップ（日次バックアップ・PITR）はありません。そのため、本番のスキーマを変えるmigrationをmergeする前に、この手順で手動バックアップを取ります。取ったバックアップは、本番の外にある使い捨てのPostgreSQLへ復元できることまで確かめます。

アプリの`/api/export`は`stores`・`deals`・`handoffs`だけを出力します。AI調査履歴・プロフィール・所属・監査ログ・migrationの来歴が含まれないため、バックアップの代わりにはなりません。

## 守ること

- **本番DBへの書き込みはしない。** この手順で本番に対して行うのは`pg_dump`と`SELECT`だけです。
- **実施するのは、本番DBの接続情報を管理する担当者だけです。** 開発者やAIエージェントは、無断で本番に接続しません。
- **ダンプには個人情報が含まれます**（店舗の連絡先、プロフィールのメールアドレス、商談内容など）。
  - リポジトリ・共有ドライブ・チャット・Issueには置きません。
  - 暗号化されたディスク上の、本人だけが読めるディレクトリ（権限`700`）に保管します。
  - 保管期限はデータの持ち主が決め、期限が来たら削除します。
- **復元先はローカルの使い捨てPostgreSQLだけです。** dev Supabaseやほかの共有環境へは復元しません。確認が終わったら復元先を削除します。
- **migrationと同時に実行しない。** `pg_dump`は全テーブルにACCESS SHAREロックを取ります。そのため、ダンプ中に`ALTER TABLE`のmigrationが走ると、ロック待ち（0033では3秒で打ち切り）でmigrationが失敗します。ダンプが終わってからmergeしてください。
- 利用の少ない時間帯に行います。

## 対象

| 含める | 含めない |
| --- | --- |
| `public`（業務データ全テーブル）、`drizzle`（migrationの来歴）、`private`（新規ユーザーのトリガー関数） | `auth`（パスワードハッシュを含むSupabase Authの管理領域）、`storage`などSupabaseが管理するスキーマ |

`auth.users`は持ち出しません。復元確認では、`profiles`のIDから`auth.users`の代わりの表を作り、外部キーが成り立つことを確かめます（手順5）。Supabaseのプロジェクトを消さない限り、`auth`はSupabase側に残ります。

## 手順0：準備

1. 本番のPostgreSQLのバージョンを確かめます。SQL Editorで次を実行します（読み取りのみ）。

   ```sql
   SHOW server_version;
   ```

2. `pg_dump`・`pg_restore`・`psql`は、**サーバーと同じか、それより新しいメジャーバージョン**を使います。古いと`server version mismatch`で止まります。

   ```bash
   pg_dump --version
   ```

3. 接続には**Session pooler（ポート`5432`）**を使います。Dashboard右上の`Connect`から、Session poolerの接続情報を開いてください。
   - アプリの`DATABASE_URL`が使うTransaction pooler（ポート`6543`）は、`pg_dump`に使えません。
   - Direct connectionは、IPv4アドオンが無いとIPv6でしかつながりません。
4. パスワードをシェルの履歴やファイルに残さないよう、環境変数は次のように設定します。リポジトリのスクリプトが誤って本番を読まないよう、`DATABASE_URL`は使いません。

   ```bash
   export PGHOST=aws-0-<region>.pooler.supabase.com PGPORT=5432 PGDATABASE=postgres
   export PGUSER=postgres.bqllbsiahnikgerckwoj PGSSLMODE=require
   read -rs PGPASSWORD && export PGPASSWORD   # 入力は表示されない
   ```

## 手順1：本番の基準値を取る

ダンプの直前に、件数と内容のハッシュを取ります（読み取りのみ）。結果は表示されたまま控えてください。ハッシュと件数だけで、データの値そのものは含みません。

```sql
SELECT t AS table_name, n AS rows, h AS content_md5 FROM (
            SELECT 'stores' t, count(*) n, md5(coalesce(string_agg(to_jsonb(x)::text, E'\n' ORDER BY x.id), '')) h FROM public.stores x
  UNION ALL SELECT 'deals', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, E'\n' ORDER BY x.id), '')) FROM public.deals x
  UNION ALL SELECT 'handoffs', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, E'\n' ORDER BY x.id), '')) FROM public.handoffs x
  UNION ALL SELECT 'store_research_runs', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, E'\n' ORDER BY x.id), '')) FROM public.store_research_runs x
  UNION ALL SELECT 'place_candidates', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, E'\n' ORDER BY x.id), '')) FROM public.place_candidates x
  UNION ALL SELECT 'notifications', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, E'\n' ORDER BY x.id), '')) FROM public.notifications x
  UNION ALL SELECT 'event_logs', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, E'\n' ORDER BY x.id), '')) FROM public.event_logs x
  UNION ALL SELECT 'profiles', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, E'\n' ORDER BY x.id), '')) FROM public.profiles x
  UNION ALL SELECT 'memberships', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, E'\n' ORDER BY x.tenant_id, x.user_id), '')) FROM public.memberships x
  UNION ALL SELECT 'tenants', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, E'\n' ORDER BY x.id), '')) FROM public.tenants x
  UNION ALL SELECT 'ai_prompt_templates', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, E'\n' ORDER BY x.id), '')) FROM public.ai_prompt_templates x
  UNION ALL SELECT 'app_settings', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, E'\n' ORDER BY x.key), '')) FROM public.app_settings x
  UNION ALL SELECT 'drizzle.__drizzle_migrations', count(*), md5(coalesce(string_agg(x.hash || ':' || x.created_at, E'\n' ORDER BY x.id), '')) FROM drizzle.__drizzle_migrations x
) s ORDER BY 1;
```

`pg_dump`は開始時点の一貫したスナップショットを書き出します。基準値を取ってからダンプが始まるまでに業務で更新があると、更新のあったテーブルだけ値がずれます。ずれた場合は、利用の無い時間に手順1と手順2をやり直してください。

## 手順2：ダンプする

```bash
umask 077
mkdir -p ~/fw-sales-backups && cd ~/fw-sales-backups
STAMP=$(date +%Y%m%dT%H%M)
pg_dump --format=custom --schema=public --schema=drizzle --schema=private \
  --file="fw-sales-prd-${STAMP}.dump"
```

- 所有者と権限（RLSの有効化、`anon`・`authenticated`からの権限の撤回）も含めて書き出します。`--no-owner`・`--no-privileges`は、ダンプ時ではなく復元確認のときだけ付けます。
- 終わったら`unset PGPASSWORD`します。

## 手順3：ファイルを確かめる

```bash
ls -l "fw-sales-prd-${STAMP}.dump"
pg_restore --list "fw-sales-prd-${STAMP}.dump" | grep "TABLE DATA"
shasum -a 256 "fw-sales-prd-${STAMP}.dump"                           # Windows の Git Bash では sha256sum
```

`TABLE DATA`は、0033の時点で13行です（`public`の12テーブルと`drizzle.__drizzle_migrations`）。本番に過去の名残のテーブルがあれば、その分だけ多くなります。手順1のSQLに無いテーブルが出てきたら、そのテーブルの件数も控えておきます。

## 手順4：使い捨てのPostgreSQLを用意する

本番と同じメジャーバージョンのPostgreSQLを、自分の端末上に起動します。例は`scripts/e2e-local.mjs`と同じApple Containerの使い方です。ポートは公開せず、端末からだけ届くコンテナの内部IPに接続します。ローカルにインストールしたPostgreSQLを`localhost`だけで待ち受けさせて使ってもかまいません。E2E用のコンテナ（`fw-sales-e2e-postgres`）は使い回しません。

```bash
container system start
container run --detach --rm --name fw-sales-restore-check \
  --env POSTGRES_PASSWORD=restore postgres:<本番と同じメジャー>-alpine
container list --all --format json   # fw-sales-restore-check の networks[0].ipv4Address を確かめる
export RESTORE_URL=postgresql://postgres:restore@<内部IP>:5432/postgres
```

## 手順5：段階的に復元する

`auth.users`はダンプに含めていないため、`profiles`の外部キーが参照する表を先に用意します。外部キーは`post-data`に入っています。そのため、データを入れた後、`post-data`の前に`profiles`のIDで埋めます。

```bash
F="fw-sales-prd-${STAMP}.dump"
psql "$RESTORE_URL" -c "CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb);"
pg_restore --no-owner --no-privileges --section=pre-data  -d "$RESTORE_URL" "$F"
pg_restore --no-owner --no-privileges --section=data      -d "$RESTORE_URL" "$F"
psql "$RESTORE_URL" -c "INSERT INTO auth.users (id, email) SELECT id, email FROM public.profiles ON CONFLICT (id) DO NOTHING;"
pg_restore --no-owner --no-privileges --section=post-data -d "$RESTORE_URL" "$F"
```

`pre-data`で出る`schema "public" already exists`の1件だけは想定どおりです。それ以外のエラーが出たら、そのバックアップは**復元を確かめられていない**ものとして扱い、原因を調べます。

## 手順6：基準値と比べる

手順1のSQLを復元先で実行します（`psql "$RESTORE_URL" -f <SQLを保存したファイル>`）。**13行すべての件数とハッシュが一致すること**を確かめます。あわせて、外部キー・トリガー・RLS・関数・索引の数を、本番（SQL Editor）と復元先で比べます。

```sql
SELECT
  (SELECT count(*) FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace) AS fks,
  (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    WHERE NOT t.tgisinternal AND c.relnamespace = 'public'::regnamespace) AS triggers,
  (SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relrowsecurity) AS rls_tables,
  (SELECT count(*) FROM pg_proc WHERE pronamespace IN ('public'::regnamespace, 'private'::regnamespace)) AS functions,
  (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public') AS indexes;
```

## 手順7：片付けと記録

```bash
container delete --force fw-sales-restore-check
```

PRまたはIssueに、次の項目**だけ**を記録します。データの値・接続情報・ファイルの保管場所は書きません。

- ダンプの日時（JST）、`server_version`、`pg_dump --version`
- ダンプのサイズとSHA-256の先頭16文字
- 手順6の結果（13行一致、外部キー・トリガー・RLS・関数・索引の数が一致）
- 想定外のエラーが無かったこと

## 本番を復元する必要が出たとき

最後の手段です。ダンプした時点より後に業務で入ったデータは、全体を復元すると失われます。本番を丸ごと上書きする前に、データの持ち主と次の点を決めてください。

- どのテーブルのどの行・列を戻すのか
- ダンプ以降に入ったデータをどう扱うのか

多くの場合は、ダンプを使い捨てのPostgreSQLに復元して必要な行を取り出し、内容を確認したSQLで本番の該当行だけを直す方が安全です。

## 検証の記録

2026-10-21、PostgreSQL 16のローカルクラスタで、この手順どおりに実行しました。

- 本番の代わりのDB：0000〜0033を適用し、seed・プロフィール・所属・AI調査履歴12件・監査ログを投入したもの
- 復元先：手順5で段階的に復元したもの

| 確認 | 結果 |
| --- | --- |
| 手順1の13行（件数とハッシュ） | 本番の代わりと復元先で全行一致 |
| 外部キー／トリガー／RLSの表／関数／索引 | 22／2／12／3／29で一致 |
| `pg_restore`のエラー | `schema "public" already exists`の1件のみ |
