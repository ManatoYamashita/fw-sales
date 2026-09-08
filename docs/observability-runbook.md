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
1.5秒以内に完了しない場合は`event: "audit.write_timed_out"`, `outcome: "unknown"`を1回出して業務応答を継続します。これはINSERT失敗確定やquery cancellationを意味しません。queryは後から成功または失敗し得ますが、自動retryは行いません。
どちらの場合も**console fallbackのみとなり、DB監査は欠落し得ます**。`audit`には検証済みイベントのみを含め、検証自体に失敗した場合はnullです。
エラーのraw message・SQL・params・detail・causeは出しません。固定message、限定したname、redact後にclipしたstack frameのみです。
通常成功時はDBのみへ保存します。単体削除の旧`[audit] stores.delete` consoleは置換済みで、二重出力しません。

レスポンス前に最大1.5秒awaitしますが、業務commitと監査insertは同一transactionではありません。process停止・実行時間切れ・接続障害による欠落を完全には防げません。
timeoutはcallerの待機だけを打ち切る小さな境界であり、DB queryをcancelしません。retry、outboxはありません。
既存`lib/db/client.ts`のhealth check / `process.exit(1)`は変更していません。このwriterをDB非依存のerror pathへ展開する前に別設計が必要です。

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
これはlive DBのcascade・rollback・role権限を実測したテストではありません。既存隔離DB基盤はApple Container用で、このWindows環境では利用していません。
