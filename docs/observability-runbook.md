# 永続監査ログ — Issue #36 Phase 1

## 目的と記録範囲

`public.event_logs` は、業務変更が成立した後に「誰が、いつ、どのStoreへ、何をしたか」を残す監査テーブルです。
**Phase 1は次の2操作と、その入口での認可拒否だけです。すべての操作を監査するものではありません。**

| Action | event | payload |
|---|---|---|
| `updateSalesProgressAction` | `stores.salesProgress.update` | `changedFields`（実際に値が変わったキーのみ） |
| `deleteStoreAction` | `stores.delete` | `deletionSucceeded: true` |
| 上記の認可拒否 | `authz.denied` | `operation`, `reason`（`unauthenticated` / `not_admin`） |

`actor_user_id` / `actor_email` はserver側で確認したprofileのsnapshotです。営業担当者IDとは異なります。
profileを確認できない拒否ではactorはnullです。`unauthenticated` は既存guardでprofileが得られなかった状態を表し、未ログイン・profile欠落・認証取得失敗を細分化しません。
`occurred_at` は監査呼出し時点のtimestamp with time zoneです。成功時は業務commit後になります。

メモ本文、FormData、顧客入力全文、削除前Store、担当者の変更後ID、日付の値は保存しません。
成功mutationの`error`はnullです。任意payloadや未知のキーはwriterのruntime allowlist検証で拒否します。
Store/profile/targetへFKを張らないため、Storeやprofileの削除後も監査行が残ります。既存reset/clearでもevent_logsを消しません。

## 保存順序と失敗時

- 営業進捗：既存transaction＋Store行ロックで比較・更新 → commit → 監査を最大1.5秒await → cache更新 → success。
- 店舗削除：DELETE成功確認 → 監査を最大1.5秒await → cache更新 → redirect。
- 同値・空patchは業務上の成功応答を維持しますが、UPDATEと成功監査を行いません。
- not found・業務DB更新失敗・transaction失敗は成功監査を作りません。
- cache失敗時は業務変更と監査が既に成立している場合があります。UIエラーだけでrollback済みと判断しないでください。

writerはinsert失敗をcatchし、業務結果へthrowしません。reject時はconsoleにJSONの`event: "audit.write_failed"`を1回出します。
1.5秒以内に完了しない場合は`event: "audit.write_timed_out"`, `outcome: "unknown"`を1回出して業務応答を継続します。自動retryは行いません。
どちらの場合も**console fallbackのみとなり、DB監査は欠落し得ます**。`audit`には検証済みイベントのみを含め、検証自体に失敗した場合はnullです。
エラーのraw message・SQL・params・detail・causeは出しません。固定message、限定したname、redact後にclipしたstack frameのみです。
通常成功時はDBのみへ保存します。単体削除の旧`[audit] stores.delete` consoleは置換済みで、二重出力しません。

レスポンス前に最大1.5秒awaitしますが、業務commitと監査insertは同一transactionではありません。process停止・実行時間切れ・接続障害による欠落を完全には防げません。retry、outboxはありません。
既存`lib/db/client.ts`のhealth check / `process.exit(1)`は変更していません。このwriterをDB非依存のerror pathへ展開する前に別設計が必要です。

## 監査書込みの接続分離とtimeout

監査INSERTは業務DBプールではなく**専用プール**(`lib/db/audit-client.ts`)で実行します。業務プールと同じ`DATABASE_URL`を使い、監査専用のcredentialは増やしていません。

| 境界 | 値 | 役割 |
|---|---|---|
| `AUDIT_DB_STATEMENT_TIMEOUT_MS` (`lib/db/audit-client.ts`) | 1000ms | 監査**接続**のDB側`statement_timeout`。lock待ちを含むquery全体をDBが中断する |
| `AUDIT_WRITE_WAIT_MS` (`lib/observability/audit.ts`) | 1500ms | callerの待機上限。最後の防御として残す外側の境界 |

DB側を短くしてあるため、通常はPostgreSQLが先に`57014`でqueryを中断し、接続が解放されてからwriterがfallbackします。

分離の理由は、監査障害が業務障害へ昇格するのを防ぐためです。共有プールでは「監査INSERTがlock待ち → callerは1.5秒で離脱 → しかし接続は監査INSERTが保持 → `DATABASE_POOL_MAX=1`では次の業務queryが詰まる」という波及が起き得ました。

**実PostgreSQL + `DATABASE_POOL_MAX=1`で検証済みの範囲**(`lib/db/__tests__/audit-pool-isolation.integration.test.ts`, CI job `Audit DB integration`):

- 監査INSERTをtable lockでブロックした状態でも、業務プールのqueryが2秒以内に完了する
- 中断後、監査プールの接続が解放され再利用できる
- ブロック解除後の次の監査書込みが永続化される
- 監査失敗がcallerへthrowされない

**保証しない範囲**: DB側boundは`statement_timeout`をstartup connection parameterとして送る方式です。この設定をSupabase Transaction Pooler経由で実測はしていません。poolerがこのparameterを拒否/無視する構成に当たった場合は`AUDIT_DB_STATEMENT_TIMEOUT_MS=0`で無効化できます。その場合もDB側boundが無くなるだけで、**専用プールによる業務プールからの隔離と1.5秒の外側境界は残ります**。無効時やpoolerが無視した場合は、timeoutしたINSERTが後から成功または失敗し得ます(`outcome: "unknown"`はこのための表現です)。

postgres.jsの`PendingQuery.cancel()`は採用していません。3.4.9の実装は内部promiseを捨てるためrejectionをconsumeできず、cancel用socketが`ECONNRESET`になるとunhandled rejectionでプロセスを落とし得ることを実測で確認したためです。監査の保険で業務プロセスを止めては本末転倒になります。

`SET LOCAL` + 明示transactionは使いません。`lib/db/store-repository.ts`に記録のとおり、Transaction Pooler (pgbouncer transaction mode) と非互換で`UNSAFE_TRANSACTION`を誘発した経緯があります。`prepare: false`は業務プールと同じく維持しています。

## DB保護とmigration

0028は既存のDrizzle規約で生成したmigrationです。手動で本番へ適用してはいません。
既存CIはmain上のmigration変更を適用するため、将来mergeする際にはアプリ配備との順序を確認してください。
未適用でwriterが失敗しても業務は継続しますが、その期間の監査はDBに残りません。

既存0010と同じpublic schema＋RLS方式です。event_logsにはclient向けpolicyを作らず、PUBLIC/anon/authenticatedから全権限を剥奪します。
RLS対象外のTRUNCATE等も含めてData API roleへ許可しません。ローカルPostgresにSupabase roleがない場合だけrole別REVOKEをskipします。

サーバーはSupabase Data APIではなく、既存`DATABASE_URL`のpostgres接続を使用します。
**直接接続というだけではRLSを回避しません。接続roleはテーブルownerまたは必要な権限を持つBYPASSRLS roleであることが前提です。**
FORCE ROW LEVEL SECURITYを指定していないためownerのINSERTは拒否されません。
実際の本番role・権限はこのPhaseの静的テストでは確認していません。merge前のstaging gateで、(1) 実アプリ`DATABASE_URL`からINSERT可能、(2) 調査用SELECT可能、(3) Store削除後もeventが残る、(4) anon/authenticated Data APIから読書き不可、の4点を確認してください。
client権限を追加してwriter障害を回避してはいけません。

根拠：[Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)、既存`drizzle/0010_add_ai_prompt_templates.sql`。

## 調査SQL（権限のある運用者のみ）

以下は例です。対象ID/email/eventと期間を置き換えて実行します。SQLを一般ユーザー向けAPIに公開しないでください。

### Store ID

```sql
SELECT id, occurred_at, kind, event, actor_user_id, actor_email, payload
FROM public.event_logs
WHERE store_id = 'store_example'
  AND occurred_at >= now() - interval '7 days'
ORDER BY occurred_at DESC, id DESC
LIMIT 100;
```

### actor email

```sql
SELECT id, occurred_at, event, store_id, payload
FROM public.event_logs
WHERE actor_email = 'operator@example.com'
  AND occurred_at >= now() - interval '7 days'
ORDER BY occurred_at DESC, id DESC
LIMIT 100;
```

emailは操作時のsnapshotなので、変更前後のemailは別検索になります。Phase 1にemail専用indexはありません。

### event

```sql
SELECT id, occurred_at, actor_email, store_id, payload
FROM public.event_logs
WHERE event = 'stores.delete'
  AND occurred_at >= now() - interval '7 days'
ORDER BY occurred_at DESC, id DESC
LIMIT 100;
```

認可拒否は`event = 'authz.denied'`で検索し、payload.operationで対象操作を確認します。
問い合わせ時刻のtimezoneを確認してください。timestampはDB sessionのtimezoneに応じて表示されます。

## 未実装・検証範囲

Sentry、instrumentation/onRequestError、digest UI、correlation ID、Workflow/AI監査、bulk全面監査、全Action展開、viewer、retention cron、client telemetry、outboxは未実装です。
自動削除もまだありません。90日で消えるとは想定しないでください。

Vitestで実writer＋mock DBを通したAction挙動、Drizzle metadata/snapshot/SQLでFK・index・timestamptz・RLS・REVOKEを検証します。
これはlive DBのcascade・rollback・role権限を実測したテストではありません。既存のApple Container隔離DB基盤はこのWindows環境では利用していません。

例外として監査書込みの接続分離だけは実PostgreSQLで検証します。CI job `Audit DB integration` が `postgres:15-alpine` service へ既存Drizzle migrationを適用し、`DATABASE_POOL_MAX=1` で回帰テストを実行します。既存のVitest jobは`USE_MOCK_DB=true`のままで、実DB化していません。
