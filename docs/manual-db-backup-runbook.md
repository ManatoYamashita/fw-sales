# 本番DBの手動バックアップと復元確認（Supabase Freeプラン）

Issue: [#384](https://github.com/ManatoYamashita/fw-sales/issues/384)

Supabaseの組織はFreeプランで、自動バックアップ（日次バックアップ・PITR）はありません。そのため、本番のスキーマを変えるmigrationをmergeする前に、この手順で手動バックアップを取ります。取ったバックアップは、本番の外にある使い捨てのPostgreSQLへ**エラー0件で**復元できることまで確かめます。

アプリの`/api/export`は`stores`・`deals`・`handoffs`だけを出力します。AI調査履歴・プロフィール・所属・監査ログ・migrationの来歴が含まれないため、バックアップの代わりにはなりません。

## このバックアップで戻せるもの・戻せないもの

この手順が対象にするのは、**業務データの復旧**です。**Supabaseプロジェクト全体の災害復旧ではありません。**

| 区分 | 対象 | このバックアップ |
| --- | --- | --- |
| 業務データの復旧 | `public`の全テーブルの行・列・制約・索引・トリガー・RLSの有効化 | ✅ 含む（手順6で、件数・内容・構造の一致を確かめる） |
| | `drizzle.__drizzle_migrations`（migrationの来歴） | ✅ 含む |
| | `private.handle_new_user()`（新規ユーザーのトリガー関数の本体） | ✅ 含む |
| | `public`・`private`の関数・テーブルに付いた権限（GRANT／REVOKE） | ⚠️ ダンプには入る。復元できるのは、参照するロールが復元先にある場合だけ（手順7で確かめる） |
| プロジェクト全体の災害復旧 | `auth`（ユーザー、パスワードハッシュ、ID連携、セッション、MFA） | ❌ 含まない。持ち出さない |
| | `auth.users`のトリガー（`on_auth_user_created`。新規ユーザーにプロフィールと所属を作る） | ❌ 含まない（`auth`スキーマにあるため） |
| | ロールそのもの（`anon`・`authenticated`・`service_role`など）と、その属性・パスワード | ❌ 含まない |
| | `ALTER DEFAULT PRIVILEGES`（今後作るテーブル・関数の既定の権限。0031で設定） | ❌ 含まない（検証したダンプに入っていなかった） |
| | `storage`（バケット・オブジェクト）。このアプリはSupabase Storageを使っていない | ❌ 含まない |
| | 拡張機能、Supabaseが管理するスキーマ、Auth・APIの設定、APIキー、Vaultなど | ❌ 含まない |

Supabaseのプロジェクトが残っている限り、`auth`やロール、設定はSupabase側に残ります。そのため、#384のように**業務データだけが壊れる事故**であれば、このバックアップで戻せます。

プロジェクトそのものを失った場合の災害復旧はできません。必要なら、次のいずれかを別途決めてください。

- 有料プランの自動バックアップやPITR
- `auth`・ロール・設定を含むバックアップ（Supabase CLIの`supabase db dump`の`--role-only`と全スキーマのダンプなど）を、復元手順と合わせて用意すること

どちらにするかは、データの持ち主が判断します。

## 守ること

- **本番DBへの書き込みはしない。** この手順で本番に対して行うのは、`pg_dump`と`SELECT`だけです。
- **実施するのは、本番DBの接続情報を管理する担当者だけです。** 開発者やAIエージェントは、無断で本番に接続しません。
- **ダンプには個人情報が含まれます**（店舗の連絡先、プロフィールのメールアドレス、商談内容など）。
  - リポジトリ・共有ドライブ・チャット・Issueには置きません。
  - 暗号化されたディスク上の、本人だけが読めるディレクトリ（権限`700`）に保管します。
  - 保管期限はデータの持ち主が決め、期限が来たら削除します。
- **復元先は、ネットワークにつながない使い捨てのPostgreSQLだけです。** dev Supabaseやほかの共有環境へは復元しません。終わったら削除します。
- **migrationと同時に実行しない。** `pg_dump`は対象の全テーブルにACCESS SHAREロックを取ります。そのため、ダンプ中にALTER TABLEのmigrationが走ると、ロック待ちでmigrationが失敗します（0033は3秒で打ち切られ、DBは変わりません）。ダンプが終わってからmergeしてください。
- 利用の少ない時間帯に行います。

## PostgreSQLのバージョン：17系を使う

本番・dev SupabaseのPostgreSQLは**17系**です。

- `pg_dump`・`pg_restore`・`psql`と、復元先のサーバーは、**どれも17系**にそろえます。16系以前では次のように失敗します（いずれも再現済み）。
  - 16の`pg_dump`は、17のサーバーを`server version mismatch`でダンプしません。
  - 17のダンプ（アーカイブ形式1.16）は、16の`pg_restore`では`unsupported version (1.16) in file header`で読めません。
  - 17の`pg_restore`がSQLを出力すると、先頭に`SET transaction_timeout = 0;`が入ります。これは16のサーバーでは実行できません。
- 手元に17系の`pg_dump`が無いときは、公式の`postgres:17-alpine`のコンテナで実行します。

## 手順0：準備

1. 本番のバージョンを確かめます。SQL Editorで次を実行します（読み取りのみ）。

   ```sql
   SHOW server_version;   -- 17.x であること
   ```

2. 手元の道具のバージョンを確かめます。

   ```bash
   pg_dump --version      # 17.x であること
   ```

3. 接続には**Session pooler（ポート`5432`）**を使います。Dashboard右上の`Connect`から、Session poolerの接続情報を開きます。
   - アプリの`DATABASE_URL`が使うTransaction pooler（ポート`6543`）は、`pg_dump`に使えません。
   - Direct connectionは、IPv4アドオンが無いとIPv6でしかつながりません。
4. パスワードをシェルの履歴やファイルに残さないよう、環境変数は次のように設定します。リポジトリのスクリプトが誤って本番を読まないよう、`DATABASE_URL`は使いません。

   ```bash
   export PGHOST=aws-0-<region>.pooler.supabase.com PGPORT=5432 PGDATABASE=postgres
   export PGUSER=postgres.bqllbsiahnikgerckwoj PGSSLMODE=require
   read -rs PGPASSWORD && export PGPASSWORD   # 入力は表示されない
   ```

## 手順1：本番の基準値を取る

ダンプの直前に、件数と内容のハッシュを取ります（読み取りのみ）。結果は表示されたまま控えます。出力はハッシュと件数だけで、データの値そのものは含みません。

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

続けて、構造の数（手順6で使う）と、クライアント用ロールの実効権限（手順7で使う）も取ります。

```sql
SELECT
  (SELECT count(*) FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace) AS fks,
  (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    WHERE NOT t.tgisinternal AND c.relnamespace = 'public'::regnamespace) AS triggers,
  (SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relrowsecurity) AS rls_tables,
  (SELECT count(*) FROM pg_proc WHERE pronamespace IN ('public'::regnamespace, 'private'::regnamespace)) AS functions,
  (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public') AS indexes,
  (SELECT count(*) FROM pg_constraint WHERE connamespace = 'public'::regnamespace) AS constraints,
  (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public') AS columns;
```

```sql
-- クライアント用ロールの実効権限。true になる組み合わせだけを出す。
WITH r(role) AS (VALUES ('anon'), ('authenticated'), ('service_role'))
SELECT r.role, 'table ' || c.relname AS object, p.priv
FROM r, pg_class c, (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) p(priv)
WHERE c.relnamespace IN ('public'::regnamespace, 'drizzle'::regnamespace) AND c.relkind = 'r'
  AND has_table_privilege(r.role, c.oid, p.priv)
UNION ALL
SELECT r.role, 'function ' || p.oid::regprocedure::text, 'EXECUTE'
FROM r, pg_proc p
WHERE p.pronamespace IN ('public'::regnamespace, 'private'::regnamespace)
  AND has_function_privilege(r.role, p.oid, 'EXECUTE')
UNION ALL
SELECT r.role, 'schema ' || n.nspname, s.priv
FROM r, pg_namespace n, (VALUES ('USAGE'), ('CREATE')) s(priv)
WHERE n.nspname IN ('public', 'private', 'drizzle') AND has_schema_privilege(r.role, n.oid, s.priv)
ORDER BY 1, 2, 3;
```

`pg_dump`は、開始時点の一貫したスナップショットを書き出します。基準値を取ってからダンプが始まるまでに業務で更新があると、更新のあったテーブルだけ値がずれます。ずれた場合は、利用の無い時間に手順1と手順2をやり直してください。

## 手順2：ダンプする

```bash
umask 077
mkdir -p ~/fw-sales-backups && cd ~/fw-sales-backups
STAMP=$(date +%Y%m%dT%H%M)
pg_dump --format=custom --lock-wait-timeout=10s \
  --schema=public --schema=drizzle --schema=private \
  --file="fw-sales-prd-${STAMP}.dump"
unset PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD PGSSLMODE   # 本番への接続情報を、ここで必ず消す
```

手元に17系の`pg_dump`が無い場合は、同じことを公式コンテナで行います。`PGPASSWORD`などは値を書かず、名前だけを渡します。

```bash
docker run --rm -e PGHOST -e PGPORT -e PGDATABASE -e PGUSER -e PGPASSWORD -e PGSSLMODE \
  -v "$PWD:/backup" postgres:17-alpine \
  pg_dump --format=custom --lock-wait-timeout=10s --schema=public --schema=drizzle --schema=private \
  --file="/backup/fw-sales-prd-${STAMP}.dump"
```

- コンテナ版の後も、同じ`unset`を実行します。
- `--lock-wait-timeout=10s`を付けると、ほかの処理がテーブルの排他ロックを持っている場合に、待ち続けず失敗します。失敗したら、時間をおいてやり直します。
- 所有者と権限も含めて書き出します。`--no-owner`・`--no-privileges`は、ダンプ時には付けません。

## 手順3：ファイルを確かめる

```bash
F="fw-sales-prd-${STAMP}.dump"
ls -l "$F"
pg_restore --list "$F" | grep "TABLE DATA"
pg_restore --list "$F" | grep -E " (SCHEMA|EXTENSION|POLICY|EVENT TRIGGER|PUBLICATION) "
shasum -a 256 "$F"                     # Windows の Git Bash では sha256sum
```

- `TABLE DATA`は、0033の時点で13行です（`public`の12テーブルと`drizzle.__drizzle_migrations`）。本番に過去の名残のテーブルがあれば、その分だけ多くなります。手順1のSQLに無いテーブルが出てきたら、そのテーブルの件数も控えておきます。
- `SCHEMA`の行は`drizzle`・`private`・`public`の3つです。ほかに`COMMENT - SCHEMA public`の行が1つ出ます。
  - `EXTENSION`・`POLICY`・`EVENT TRIGGER`・`PUBLICATION`が出てきた場合は、想定外のものが入っています。手順5の前に、何が入っているのかを確かめてください（現在のmigrationには、どれも無い）。

## 手順4：使い捨てのPostgreSQL 17を用意し、初期化する

本番と同じ**17系**のPostgreSQLを、ネットワークにつながない状態（`--network none`）で起動します。E2E用のコンテナ（`fw-sales-e2e-postgres`）は使い回しません。

> **手順4〜7は、必ずこのコンテナの中（下の`R`）で実行します。** 手元の`psql`・`createdb`・`pg_restore`を使わないでください。次の3つが、接続先を間違えて本番に`DROP SCHEMA`や`createdb`を流す事故を防ぎます。
>
> - コンテナはネットワークにつながっていないため、本番に届きません。
> - `docker exec`は、ホスト側の`PG*`環境変数を引き継ぎません。
> - `DROP SCHEMA public`には`CASCADE`を付けません。中身のある`public`では失敗するので、最後の安全装置になります。`CASCADE`を足さないでください。

```bash
docker run -d --name fw-sales-restore-check --network none -e POSTGRES_PASSWORD=restore postgres:17-alpine
docker cp "$F" fw-sales-restore-check:/tmp/backup.dump
R() { docker exec -i fw-sales-restore-check "$@"; }   # 以下、コンテナの中で実行する
```

Apple Containerを使う場合は、`docker`を`container`に読み替えます（`scripts/e2e-local.mjs`と同じ使い方）。

復元先のDBは、次のように初期化します。

```bash
R createdb -U postgres -T template0 restore_check
R psql -v ON_ERROR_STOP=1 -U postgres -d restore_check \
  -c "DROP SCHEMA public;" \
  -c "CREATE SCHEMA auth;" \
  -c "CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb);"
```

それぞれの操作の理由は次のとおりです。

- **`template0`から作る：** `template1`に入っているかもしれない独自のオブジェクトを持ち込まないため。
- **`public`を消す：** ダンプは`CREATE SCHEMA public`から始まります。`public`を残したままだと、`--exit-on-error`で最初の1文目から止まります（再現済み）。
- **`auth.users`の代わりの表を作る：** `profiles.id`の外部キーが参照するためです。`auth`はダンプしていません。

## 手順5：エラー0件で復元する（業務データと構造）

```bash
for SECTION in pre-data data; do
  R pg_restore -U postgres -d restore_check --no-owner --no-privileges \
    --exit-on-error --single-transaction --section=$SECTION /tmp/backup.dump || { echo "失敗: $SECTION"; break; }
done
R psql -v ON_ERROR_STOP=1 -U postgres -d restore_check \
  -c "INSERT INTO auth.users (id, email) SELECT id, email FROM public.profiles ON CONFLICT (id) DO NOTHING;"
R pg_restore -U postgres -d restore_check --no-owner --no-privileges \
  --exit-on-error --single-transaction --section=post-data /tmp/backup.dump
```

- 外部キーは`post-data`に入っています。そのため、データを入れた後に、`profiles`のIDで`auth.users`の代わりの表を埋めます。
- **3回の`pg_restore`がすべてexit 0で、エラーが1件も出ないこと**を確かめます。1件でもエラーがあれば、そのバックアップは**復元を確かめられていない**ものとして扱い、原因を調べます。
  - エラーを許容して先へ進まないでください。
  - オプションを緩めてやり直すこともしないでください。
- 途中で失敗した場合、それまでに成功したセクションの分は残っています。`restore_check`を削除し、手順4の初期化からやり直します。
- **`--no-owner --no-privileges`は、この確認のためだけのオプションです。** このオプションで復元すると、関数の`EXECUTE`の撤回が失われます。その結果、`anon`・`authenticated`が`private.handle_new_user()`などを実行できる状態になります（再現済み）。
  - **SupabaseのDBへ復元する手順として流用しないでください。**

## 手順6：基準値と比べる

手順1の2つのSQL（基準値と構造の数）を、復元先で実行します。

```bash
R psql -X -A -U postgres -d restore_check -f - < baseline.sql   # 手順1の SQL を保存したファイル
```

**基準値の13行すべてと、構造の数がすべて、本番と一致すること**を確かめます。

## 手順7：権限を復元できるかを確かめる

手順5では権限を外しました。ここでは、権限も含めて復元できるかを、別のDBで確かめます。

1. ダンプのGRANT／REVOKEが参照するロールを洗い出します。

   ```bash
   R sh -c "pg_restore -f - /tmp/backup.dump | grep -E '^(GRANT|REVOKE)'"
   ```

2. 出てきたロールのうち、`PUBLIC`と`postgres`以外を、復元先に`NOLOGIN`で作ります。Supabaseでは、`anon`・`authenticated`・`service_role`が出てくる想定です。手順1の実効権限のSQLが、この3つのロールを参照するため、出てこなくても作っておきます。

   ```bash
   R psql -v ON_ERROR_STOP=1 -U postgres \
     -c "CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;"
   ```

3. 手順4と同じ初期化をした`restore_acl`を作り、手順5から`--no-privileges`だけを外して復元します。`--no-owner`は残します。これも、エラー0件であることを確かめます。
4. `restore_acl`で手順1の実効権限のSQLを実行し、本番と比べます。
   - **本番に無い権限が1行でも出たら、不合格です。**
   - 本番にあって復元先に無いもの（復元先の方が厳しいもの）は、差として記録します。
   - 例：`schema public | USAGE`。手順4で`public`を作り直したため、Postgresが`public`に既定で付けるPUBLICのUSAGEが付きません。

所有者（`--no-owner`）と既定の権限（`ALTER DEFAULT PRIVILEGES`）は、この確認の対象外です。どちらもダンプからは戻りません。

## 手順8：片付けと記録

```bash
docker rm -f fw-sales-restore-check
```

PRまたはIssueに、次の項目**だけ**を記録します。データの値・接続情報・ファイルの保管場所は書きません。

- ダンプの日時（JST）、`server_version`、`pg_dump --version`、`pg_restore --version`
- ダンプのサイズと、SHA-256の先頭16文字
- 手順5：3回の`pg_restore`がexit 0・エラー0件だったこと
- 手順6：基準値の13行と構造の数が一致したこと
- 手順7：本番に無い権限が出なかったこと、記録した差

## 本番を復元する必要が出たとき

最後の手段です。ダンプした時点より後に業務で入ったデータは、全体を復元すると失われます。本番を上書きする前に、データの持ち主と次の点を決めてください。

- どのテーブルのどの行・列を戻すのか
- ダンプ以降に入ったデータをどう扱うのか

多くの場合は、次の方が安全です。

1. ダンプを使い捨てのPostgreSQLに復元する（手順4〜5）
2. 必要な行を取り出し、内容を確かめる
3. 確認したSQLで、本番の該当行だけを直す

本番に`pg_restore`する場合は、次のことを**しません**。

- `--no-privileges`を付けて復元する（権限が緩む）
- `public`スキーマを消す（`DROP SCHEMA public`）、または`--clean`で作り直す（Supabaseのロールへの権限と、`auth`からの外部キーの参照先が失われる）
- Supabaseの管理するスキーマ（`auth`・`storage`など）に書き込む

## 検証の記録

本番・dev Supabaseには接続していません。どちらの検証も、本番の代わりに作ったデータ入りのDBで行いました。

- 本番の代わりのDB：0000〜0033を適用し、seed・プロフィール・所属・AI調査履歴12件・監査ログ・通知・候補を入れたもの
- 本物のSupabaseのPostgreSQL（Supabase独自の拡張・ロール・既定の権限を持つ）では確かめていません。

### PostgreSQL 17.11（公式`postgres:17-alpine`）：この手順書の版（2026-10-21）

本番の代わりのDBには、Supabaseと同じ名前のロール（`anon`・`authenticated`・`service_role`）を作りました。0031の権限の撤回が、実際に実行された状態です。復元先は、ネットワークにつながない別のコンテナです。

| 確認 | 結果 |
| --- | --- |
| `public`を残したDBへ、`--exit-on-error --single-transaction`で復元する（反証） | `CREATE SCHEMA public`で停止し、テーブルは0件（全体がROLLBACK） |
| 手順4の初期化をしたDBへの、手順5の3回の`pg_restore` | すべてexit 0、エラー0件 |
| 基準値の13行 | 全行一致 |
| 外部キー／トリガー／RLSの表／関数／索引／制約／列 | 22／2／12／3／29／36／162で一致 |
| 手順7（権限付き、`--no-owner`のみ） | エラー0件。本番に無い権限は0件。差は`schema public`のUSAGE（3ロール。復元先の方が厳しい）だけ |
| 手順5の`--no-privileges`版の実効権限 | 3ロールが3つの関数を`EXECUTE`できる（本番より緩い。Supabaseへの流用を禁じた理由） |
| 16の`pg_restore`で17のダンプを読む | `unsupported version (1.16) in file header`で失敗 |

### PostgreSQL 16（ローカルのバイナリ）：旧版の手順（参考）

`schema "public" already exists`の1件のエラーを許容する旧版の手順で、基準値の一致を確かめたものです。本番が17系のため、**この結果を本番のバックアップの根拠にはしません**。
