# 契約連絡先メールアドレス（stores.contact_email）の段階リリース

Issue: [#384](https://github.com/ManatoYamashita/fw-sales/issues/384) ／ Phase 1: PR [#387](https://github.com/ManatoYamashita/fw-sales/pull/387) ／ Phase 2: PR [#388](https://github.com/ManatoYamashita/fw-sales/pull/388)

`main`へのpushでは、VercelのデプロイとGitHub ActionsのApply Migrations（dev→prd）が互いを待たずに進みます。新しい列を読むアプリが列より先に本番へ出ると、店舗の一覧・詳細が`column does not exist`で落ちます。そのため、DBの変更とアプリの変更を2つのPRに分けます。

| 段階 | 変えるもの | 変えないもの |
| --- | --- | --- |
| Phase 1（#387） | `drizzle/0033_add_store_contact_email.sql`。`--custom`で生成したため、snapshotは0032と同じ | `lib/db/schema.ts`、型、アプリ |
| Phase 2（#388） | `schema.ts`・型・画面・Actions、列の定義を確かめるmigration（0034） | 列そのもの（Phase 1で追加済み） |

## Phase 1：merge前と適用後

1. **merge前：** [手動バックアップと復元確認](manual-db-backup-runbook.md)を済ませ、結果をPR #387に記録します。Freeプランには自動バックアップがありません。
2. **merge前：** PR #387の「適用前の確認」のSELECTを、本番で取ります。
3. **merge：** 利用の少ない時間帯に行います。`pg_dump`が終わっていることを確かめてから、mergeしてください。
4. **適用後：** Apply Migrationsのmigrate-devとmigrate-prdが成功し、両方で`db:verify-hashes`と`db:verify-fks`がOKになることを確かめます。
5. **適用後：** 次の「Phase 2の着手条件」のSQLを、本番とdevで実行します。
6. **記録：** 結果を#384に記録します（対象SHA・日時・SQLの結果）。

## Phase 2の着手条件

本番とdevの両方で、次のSELECTの結果が期待どおりになっていることを確かめます（SQL Editorで、読み取りのみ）。

```sql
SELECT data_type, is_nullable, column_default, character_maximum_length
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'stores' AND column_name = 'contact_email';
-- 期待: text | NO | ''::text | NULL （ちょうど1行）

SELECT count(*) AS total, count(*) FILTER (WHERE contact_email <> '') AS filled FROM stores;
-- 期待: filled = 0 （Phase 2 を出すまで、列に書き込む経路は無い）

SELECT max(created_at) FROM drizzle.__drizzle_migrations;
-- 期待: 1792555307007 以上 （0033 の when）
```

1行も返らない場合や、型・NOT NULL・DEFAULTのどれかが違う場合は、Phase 2に進みません。列の定義をアプリに合わせて変えるのではなく、Phase 1の適用経緯を調べてください。

## Phase 2のPRで必須のチェック

### 1. 二重のADD COLUMNを、列の定義を確かめるブロックに置き換える

`schema.ts`の`stores`に、次の定義を足します。0033と同じ定義（text・NOT NULL・DEFAULT `''`）です。

```ts
contact_email: text("contact_email").notNull().default(""),
```

`pnpm db:generate --name=assert_store_contact_email`を実行すると、Drizzleは列が無いものとして、もう一度`ADD COLUMN`を生成します。

```sql
ALTER TABLE "stores" ADD COLUMN "contact_email" text DEFAULT '' NOT NULL;
```

- **この行が上と1文字でも違う場合は、`schema.ts`の定義が0033と違います。** DBではなく`schema.ts`を直します（例：`varchar`になっている、`.notNull()`や`.default("")`が無い）。
- 違いが無ければ、生成されたSQLファイルの中身を、**下のブロックに丸ごと置き換えます**。一緒に生成されたsnapshotは、そのままにします（列を含むsnapshotになり、`schema.ts`と一致します）。

```sql
-- 0033 で追加済みの stores.contact_email が、schema.ts と同じ定義 (text / NOT NULL / DEFAULT '') かを確かめる (#384)。
-- information_schema.columns を読む間だけ stores の AccessShare ロックを一瞬取るため、待ちを 3 秒で打ち切る。
SET LOCAL lock_timeout = '3s';
--> statement-breakpoint
DO $$
DECLARE
  col record;
BEGIN
  SELECT data_type, is_nullable, column_default
    INTO col
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'stores' AND column_name = 'contact_email';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stores.contact_email がありません。0033_add_store_contact_email の適用を確認してください。';
  END IF;
  IF col.data_type <> 'text' OR col.is_nullable <> 'NO' OR col.column_default IS DISTINCT FROM '''''::text' THEN
    RAISE EXCEPTION 'stores.contact_email の定義が想定と違います (type=%, nullable=%, default=%)。',
      col.data_type, col.is_nullable, col.column_default;
  END IF;
END $$;
```

ほかの書き方を選ばない理由は次のとおりです。

| 書き方 | 問題 |
| --- | --- |
| 生成された`ADD COLUMN`のまま | 列のあるdev・prdで`column already exists`になり、Apply Migrationsが失敗する。Vercelはアプリを先に配信するので、migrationの来歴が止まったまま本番が動くことになる |
| `ADD COLUMN IF NOT EXISTS` | 既存の列の型・NOT NULL・DEFAULTが違っていても、NOTICEを出すだけで通る（NULL許容の列で再現済み）。さらに、何もしない場合でも`stores`のACCESS EXCLUSIVEロックを取る |
| 確認ブロック（採用） | 列の定義を読むだけ。列が無い場合と定義が違う場合は、migration全体を失敗させる |

確認ブロックは`information_schema.columns`を読む間だけ、`stores`のAccessShareロックを一瞬取り、読み終えるとすぐ放します。通常の読み書きとはぶつかりません。ただ、ほかのDDLが`stores`の排他ロックを持っていると、その間は待たされます（PostgreSQL 17.11で再現済み）。そのため、0033と同じく`lock_timeout`を3秒にしています。

### 2. レビューで確かめること（PRのチェックリストに写す）

- [ ] 新しいmigrationに`ADD COLUMN "contact_email"`・`DROP`・`UPDATE`・`TRUNCATE`が無く、上の確認ブロックだけがある
- [ ] 生成直後の`ADD COLUMN`の行が、上に示した1行と完全に一致していた（`schema.ts`の定義が0033と同じ）。PRに貼って示す
- [ ] 置き換え後にもう一度`pnpm db:generate`を実行し、`No schema changes`になる
- [ ] `pnpm db:check`が通り、journalの`when`が0033より新しい
- [ ] CIの`Audit DB integration`が通る。空のDBに0033と新しいmigrationを順に流し、`store-contact-email-column.integration.test.ts`で次を確かめる
  - 列の定義が`text`／`NO`／`''::text`であること
  - キーの無い入力で既存のアドレスが消えないこと
- [ ] ローカルの使い捨てDBで、次の3つを確かめた結果をPRに記録する
  - 0033まで適用したDBで、新しいmigrationが通る
  - 空のDBに全migrationを流すと通る
  - 列をNULL許容にしたDBでは、新しいmigrationが失敗し、適用記録が増えない
- [ ] merge直前に、「Phase 2の着手条件」のSQLを本番とdevでもう一度実行し、期待どおりである
- [ ] merge後、Apply Migrationsのmigrate-dev・migrate-prdが成功する。失敗した場合は、新しいアプリが列の無い環境で動いていないかをまず確かめる

### 3. アプリ側で確かめること

Issue #384の「本番安全性レビュー」とPR #387の補足から、DBに関わるものを抜き出します。

- [ ] 旧画面・旧フォームの保存で、アドレスが消えない
  - フォームに`contact_email`の項目が無ければ、patchに含めない
  - 空欄を送ってきた場合だけ、明示的な削除として扱う
- [ ] JSONインポートにも、Actionと同じ正規化・検証を通す。いまの`toDbRow`は`...store`をそのまま展開するため、検証していない値が保存されてしまう
- [ ] `Store`全体をクライアントコンポーネントに渡しているページで、アドレスを渡すかどうかを決める
  - 対象：`pipeline/_components/kanban-board.tsx`、`dashboard/_components/action-queue.tsx`、`research/[storeId]`など
- [ ] 監査payloadは`changedFields`（項目名）だけのまま。アドレスの値をログ・エラー本文・AIのプロンプトに入れない

## Phase 1からPhase 2までのマージ順序

PR #388はPR #387のブランチを土台にしたPRです（stacked PR）。次の順に進め、どの段階でも条件を満たさなければ止めます。

1. **PR #387のマージ前：** [手動バックアップと復元確認](manual-db-backup-runbook.md)を、PostgreSQL 17系で、エラー0件で終えます。結果は#387に記録します。PR #388はDraftのままにします。
2. **PR #387をmainにマージする：** Apply Migrationsのmigrate-devとmigrate-prdが成功し、両方で`db:verify-hashes`と`db:verify-fks`がOKになることを確かめます。
3. **「Phase 2の着手条件」のSQLを、本番とdevで実行する：** 期待どおりであることを確かめ、結果を#384に記録します。
4. **PR #388のベースをmainに変える：** GitHubで「Edit」からbaseを`main`に変えます。#387がsquashではなく通常のmergeであれば、差分はPhase 2の分だけになります。squash mergeだった場合は、`git rebase --onto origin/main feat/issue-384-db-contact-email`でPhase 2のcommitだけを載せ直します。
5. **ほかのmigrationが先にmainへ入っていないかを確かめる：** mainの最後のmigrationが0033でなければ、0034の番号・journal・snapshot（prevId）を作り直します。生成し直したSQLの中身は、もう一度確認ブロックに置き換えます。そのうえで`pnpm db:generate`が`No schema changes`になることを確かめます。
6. **Vercel Previewを再実行する：** devに0033が入った後は、Previewのビルドが通るはずです。通らない場合は、ログで`contact_email`以外の原因を調べます。PreviewはdevのDBを使います。Previewを通すためだけに、devへ手でmigrationを流すことはしません。
7. **CIの全ジョブとPreviewが成功し、レビューが済んだら、PR #388をReady for reviewにする：** マージは利用の少ない時間帯に行います。0034は列の定義を確かめるだけなので、データは変わりません。
8. **PR #388をマージした後：** Apply Migrationsが成功し、来歴が35件（`max(created_at)`が0034の`when`）になることを確かめます。そのうえで、本番の店舗詳細でアドレスの登録・コピー・削除ができること、一覧画面のHTMLにアドレスが含まれないことを確かめます。

## 切り戻し

- **migrationのcommitをrevertしない。** 適用済みの来歴がorphanになり、`db:verify-hashes`で以後のApply Migrationsが止まります。
- **Phase 2のアプリに問題が出た場合：** Vercelで直前のデプロイに戻します。列は残したままで、旧版のアプリは列があっても動きます。Phase 2の間に登録されたアドレスは列に残ります。旧版のアプリは、列を知らないまま更新しても値を消しません（Phase 1の結合テストで確認済み）。
- **Phase 2のmigrationが失敗した場合：** トランザクション全体がROLLBACKされます。確認ブロックの失敗メッセージ（Supabaseの Postgresログに出ます）で原因を調べ、`schema.ts`と本番の定義のどちらが想定と違うのかを切り分けます。
- **列を消す必要がある場合：** Phase 2を出す前で、かつ`filled = 0`の場合に限ります。新しい`--custom`のmigrationで`ALTER TABLE "stores" DROP COLUMN IF EXISTS "contact_email";`を流します。
