# Issue 368 店舗領域のテナント分離

親: [#365](https://github.com/ManatoYamashita/fw-sales/issues/365) ／ 実装: [#368](https://github.com/ManatoYamashita/fw-sales/issues/368) ／ ガード: [#369](https://github.com/ManatoYamashita/fw-sales/issues/369)

## PLAN と移行単位

#367 / PR #381 が main にマージされた a4d9ca2 を起点に、店舗領域を最初の PR とする。プロジェクトの AGENTS.md、Next.js 16.3.1 の bundled docs (`use cache` / `cacheTag` / `updateTag`)、Supabase / Postgres のガイド、better-ui、Design Report のテンプレートを参照した。

- [x] 店舗と店舗候補の repository にテナントを束縛する
- [x] キャッシュキーと全タグに tenantId を渡す
- [x] 担当者と照合先店舗の所属を検証する
- [x] #369 のスキーマ・キャッシュタグ・実 DB ガードの骨格を追加する
- [x] 通常テスト、型検査、実 DB、反証を検証する
- [ ] 商談、調査、ユーザー領域の repository を後続 PR で移行する

**この PR は Issue 368 全体を完了しない。2社目の運用開始条件を満たした扱いにしない。**

## DO と API の契約

店舗領域は `repos.forTenant(tenantId).store` と `.placeCandidate` から利用する。`repos.store`、`repos.placeCandidate` と未束縛の DB singleton を削除した。`makeStoreRepo(executor, tenantId)` / `makePlaceCandidateRepo(executor, tenantId)` も第2引数が必須で、transaction の executor に同じテナントを束縛する。

すべての一覧、単一取得、行ロック、更新、削除、一括削除、エリア検索に `tenant_id` の条件を適用する。エリア検索の OR 条件全体をテナント条件で囲む。削除影響集計は各子テーブルと親店舗の両方を絞り、他社の件数を返さない。INSERT は tenant_id を明示し、PATCH は tenant_id / id / created_at の書き換えを受け付けない。

担当者は対象テナントの memberships への所属を検証する。担当者を表示するプロフィール取得クエリも所属で絞る。店舗候補の matched_store_id は同じテナントの店舗だけを受け付ける。

キャッシュの形は `CACHE_TAGS.stores(tenantId)` / `CACHE_TAGS.store(tenantId, id)` とする。全要素が tenantId 必須の関数であり、生成結果は `tenant:<tenantId>:<従来のタグ>`。`use cache` の関数は tenantId を引数に取り、内部で `resolveTenantId()` や動的 API を呼ばない。読み取りと失効の双方で同じ ID を使う。

`resolveTenantId()` は #373 まで Firstweb の定数を返す。定数は `lib/tenant/id.ts` に置き、テナント解決をスキーマや DB 初期化から独立させた。

`backfill-basic-info.ts` は未束縛 singleton の削除に合わせて `--tenant-id <UUID>` を必須にした。ほかの運用スクリプト全体の棚卸しは #370 で扱う。

## CHECK とガード

既存 CI の Vitest と実 PostgreSQL integration job で次を実行する。

| ガード | 対象と検出内容 |
| --- | --- |
| スキーマ | tenants / profiles / memberships 以外の全テーブルが tenant_id NOT NULL を持つ |
| キャッシュ | 全タグのテナント間差分、cacheTag / revalidateTag / updateTag の由来、キャッシュ関数の明示引数 |
| 実 DB | 店舗10・候補2の全メソッド、2テナント、他社の取得・変更・削除、担当者と参照先の所属 |
| 網羅性 | 実 repository の Object.keys と対象表を照合し、空の表も拒否。型でも keyof と照合 |
| 構築 | 通常 executor と transaction executor に同じ tenantId が渡ること |

タグ走査はリテラル、文字列連結、テンプレートリテラル、変数参照を検査する。const のタグ変数、タグ配列の for-of、next/cache の別名 import も扱う。変数の再代入を許す let は拒否する。

### ローカルでの実行

```bash
pnpm typecheck
pnpm lint
DATABASE_URL=postgresql://test:test@localhost:5432/test pnpm test
# migration 済みの専用 PostgreSQL を明示する
APP_ENV=local DATABASE_URL='<専用DB>' DATABASE_POOL_MAX=1 pnpm test:integration
```

本作業では Apple Container 上に専用データベース `fw_sales_issue_368` を作成した。クラウドの dev / prd を書き換えていない。fixture と DEFAULT の一時削除は同じ transaction の中で行い、毎回 ROLLBACK する。

### 反証結果

| 変更 | 結果 |
| --- | --- |
| store.get の WHERE から tenant 条件を1か所削除 | `store.get` の実 DB テストが失敗 (終了コード1) |
| 同じ条件を復元 | 同じケースが成功 (終了コード0) |
| 店舗の対象表を空にする | 網羅性テストが失敗 (終了コード1) |
| 反証用の変更をすべて復元 | 元の実装と対象表で検証を継続 |

## ACTION と残作業

1. 商談: deals / handoffs / パイプライン / KPI / アクションキューを移行する。
2. 調査: store_research_runs と Workflow を移行する。Workflow は要求の外で動くため、#373 より前に tenantId を起動引数へ渡す。
3. ユーザー: notifications / ai_prompt_templates / app_settings / event_logs とプロフィール repository を移行する。ユーザーが複数社に所属するケースも検証する。
4. #369: 後続領域の全メソッドを実 DB の対象表に追加し、最後に移行途中の例外を撤去する。複合 FK のガードは #371 の変更と合わせる。
5. #370: エクスポート、JSON インポート、リセット、全削除、seed、直接接続する運用スクリプトを閉じる。今回変更した店舗のエクスポート以外の経路には全体を対象にする SQL が残る。
6. #371: DEFAULT を外し、Google Place ID と一意制約・外部キーを複合化する。

現在の Google Place ID の一意制約はグローバルのまま。A と B が同じ候補を保存しようとすると新規 INSERT は一意制約で失敗するが、他社の既存行は更新しない。両社がそれぞれ保存できることは #371 の完了条件である。

TenantRepos が直接公開するのは移行済みの店舗と候補だけ。transaction コールバックの店舗以外の repository、および root のほかの repository は移行途中で、テナント分離を保証しない。

## 今回の知見とルール更新提案

- 【発見した問題・課題】単一 ID 以外にも、OR 検索、子テーブル集計、Google Place ID の照合が境界を越えうる。
- 【解決した方法】ファクトリで tenantId を束縛し、実メソッドの列挙と2テナントの fixture で網羅性を検証した。
- 【推奨するルール追加・更新】新しい repository メソッドを追加したら同じ PR で漏えいテストの対象表へ追加し、条件を外す反証も行う。キャッシュ内ではテナントを解決しない。
- 【次回同様のタスクで参照すべき情報】本書、tenant-store-isolation.integration.test.ts、isolation-guards.test.ts、Next.js の bundled docs。
- 【次に行うべきこと】店舗領域の PR をレビュー後、商談領域を独立した PR で移行する。

### 動作確認結果

- 通常テスト: 206ファイル、4,843件成功。
- 実 DB: 5ファイル、35件成功。反証の復元後にも全件を実行した。
- 型検査: 成功。ESLint: エラー0件。Workflow が自動生成する既存 JS の unused disable 警告2件のみ。
- Next.js dev: 全ルートの get_compilation_issues が0件。最初のフォント解決エラーはサーバー停止後に生成キャッシュを退避して解消した。
- 画面: 店舗一覧、店舗詳細、390px の表示、検索を確認。スタイル・アニメーションの変更はない。
- E2E (通知・営業状態・smoke): 9件成功、営業記録のフォーム展開1件失敗、後続2件未実行。変更前の main (a4d9ca2) を別ディレクトリで起動し、同じ locator での90秒タイムアウトを再現した。今回の差分で直したとは扱わない。
- React の追加診断: agent-browser の hook が renderer に接続できず Not verified。
- better-ui: コード差分に新たな UI polish の変更点はない。全操作状態と Animations パネル10%再生は Not verified。営業記録フォームの既存停止を含む UI 全体の判定は Block とする。

ローカル認証環境は production server で起動しない設計であり、`APP_ENV=local` の `next build` はページ収集時に拒否される。production build を確認する際は、実際の dev 環境を読み取り専用で利用し、テスト認証のガードを無効化しない。

production build は dev の接続先を検証した環境で成功した。AI 呼び出しは行わず、未設定の Gemini キーはビルド専用ダミー値を使った。`/stores`、店舗詳細、編集、登録、dashboard、pipeline などは Partial Prerender (`◐`) のままで、今回の定数テナント解決によって静的シェルを失っていない。
