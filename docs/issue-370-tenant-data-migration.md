# Issue 370 データ移送と運用スクリプトのテナント分離

親: #365 ／ 実装: #370 ／ 前段: #368 / #369 ／ 次段: #371

## PLAN

#393、#394を指定順にマージしたmain `1ecfb39`から実装した。merge commitは `d38d491`、`1ecfb39`。両PRのhead、全7項目のCIとbase変更後のソース一致を確認した。mainのCI / E2Eも成功している。

参照: AGENTS.md / CLAUDE.md、#368各領域の記録、#369、Next.js 16.3.1同梱のRoute Handler / revalidateTag資料、SupabaseとPostgresガイド（ロック順・所属分離）。新しい依存や本番DDLは追加しない。

- [x] exportの認証と所属を実DBで検証
- [x] importはIDを維持し、衝突・参照違反時に全体rollback
- [x] clear/resetを自社だけに限定し、seedのIDと参照をテナントごとに生成
- [x] 運用CLIの対象を必須化し、全体検証の例外を棚卸し
- [x] 実DB・単体・反証・型・lint・build
- [x] ブラウザーでexport/import/衝突/clear/resetを確認
最終CIの結果はPRとIssueへ記録する。

## DO

### データ操作の境界

`repos.forTenant(tenantId).data` にimportSnapshot / clear / resetToSeedを置く。それぞれ内部でtransactionを開始するため、呼び出し元が包み忘れて部分適用になる入口を作らない。既存の業務transaction用集合には含めない。data-actionsから直接DMLを撤去し、認可・環境ガード・成功後の所属タグ失効を維持した。

export routeは前段で所属付きrepositoryへ移行済み。B管理者の3 entityがBだけになることを実DBで確認する。同じsnapshotを返すServer Actionにも現在の所属を確認する認証ガードを追加した。未所属・未ログインはデータを返さない。

### インポートのID方針

IDは保持する。既存のバックアップ復元と親子参照を維持するため、別IDへ振り直すコピー操作とはしない。別社のIDに衝突すると各upsertのsetWhereで更新0件となり、例外で先行した自社の追加・更新も全体を取り消す。部分適用はしない。旧researchキーは従前どおり無視する。

JSONの列をDBの既知列に限定し、tenant_idは指定テナントで上書きする。店舗の担当者、商談の店舗と担当者、引き継ぎの店舗と商談の組合せは同じ所属に限定する。参照確認ではkey shareを取得する。DBドライバー・入力エラーは従来の汎用メッセージで返す。

### clear/resetと旧データ

handoffs → deals → storesの順に所属WHERE付きで削除する。自社の調査runのcascadeと候補のmatched_store_idのSET NULLは従前どおり。ユーザー・通知・テンプレート・設定・監査は削除対象に増やさない。

#371の複合FK前は、旧コードが作った別社の子が自社の親へ紐付いている可能性がある。自社の店舗・商談をID順にロックし、他社の商談・引き継ぎ・調査run・候補がその親を参照していれば、削除開始前に全体を拒否する。tenant WHEREだけではCASCADE / SET NULLの波及を止められないための保護である。権限を持つ外部SQL writerの全面的な分離は#371のDB制約でも保証する。

### シードとCLI

createTenantSeedはtenant UUIDで店舗・商談・引き継ぎIDと親参照を一緒に変換する。Firstwebだけは既存運用・E2Eの固定IDを維持し、他社はUUID namespaceを付けて衝突を避ける。対象テナントを暗黙にFirstwebへ補完する処理は置かない。

CLIは接続初期化前に `--tenant=<slug>` または `--tenant-id=<UUID>` を1つ要求し、対象の実在も確認する。等号・空白区切りを受理し、不正・重複・未指定は拒否する。

```sh
pnpm seed --tenant=firstweb
pnpm db:set-role --tenant=firstweb --email=user@example.test --role=admin
pnpm db:list-name-memos --tenant=firstweb
pnpm db:backfill-basic-info --tenant=firstweb --apply
```

## 直接接続するスクリプトの棚卸し

| 対象 | 所属と理由 |
| --- | --- |
| seed.ts | 対象必須、所属付きdata repositoryで全体transaction |
| set-profile-role.mjs | 対象必須、membershipsのtenant/userだけを更新 |
| list-store-name-memos.ts | 対象必須、名称一覧と同名候補もその会社だけ |
| backfill-basic-info.ts | 対象必須、束縛store repositoryで読取・merge |
| local-preview.mjs | 所有ラベルで管理する専用DBの初期化はDB全体。共有identityの旧ID修復も全参照が対象。業務seed・件数・roleはFirstweb明示 |
| e2e-setup.mjs / e2e-local.mjs | 専用テストDBのschema/auth fixtureとSELECT 1は全体。seedはFirstweb明示 |
| benchmarkのsh/mjs | 所有tokenで検証した破棄専用local clusterだけを全体測定。運用DBへ接続しない。合成行にもFirstwebのtenant_idを明示 |
| diagnose-area-search-plan.mjs | 共有planner/statisticsと現行global indexの診断なので全体。業務行の変更はしない。#371でtenant indexに合わせてSQLも更新する |
| verify-store-cascade-fks.mjs | DB全体のschema/FK契約を検証するため全体、読取のみ |
| verify-migration-hashes.mjs | 共有migration来歴を検証するため全体、読取のみ |
| check-environment / check-required-env | 接続設定の検査。業務行の読取・書込はしない |
| Drizzle migrate/generate/studio / migration検査 | DB管理用の明示的な運用入口。共通schema・来歴が対象で、アプリのテナント操作ではない |
| keepalive workflow / cron | workflowはDB全体の疎通確認として件数のみ読む。cronの記録は前段でFirstwebへ束縛済み |
| e2e fixture | 専用DBのFirstwebを対象とする。通知・調査runのINSERTにも所属を明示。店舗コピーは元行のtenant_idを継承 |

全体対象を残すscript・workflowには理由のコメントも記録した。

## CHECK

- 単体: 211ファイル・4,901件成功。引数の境界とDB初期化前の拒否、ID namespaceと親参照、legacy snapshot互換、環境ガード、失敗時のタグ非失効を検査。
- 実DB: 10ファイル・114件成功。新規data repositoryは全3メソッドをkeyof / 実Object.keysへ照合し、空対象表も拒否。Bから全操作を実行し、Aの店舗・商談・引き継ぎ・調査・候補の全行不変を比較する。
- 実DB26件で、3種のPK衝突、親参照・担当者違反、先行INSERT / UPDATEの全体rollback、DEFAULTを外したINSERT、旧他社参照のcascade / SET NULL拒否、route/actionのexport、認証拒否を検査。
- 実CLI1件でA/Bへseedを反復投入、兼務者のBだけを昇格、Bの名称一覧とbackfill適用、不明tenantの失敗を確認。Aの行を前後比較し、検証専用の行はfinallyで除去した。
- 反証7種: store / deal / handoffのupsert条件、clearの所属、旧参照保護を外すと実テストが失敗、復元後成功。exportにA repositoryを接続しても失敗する。対象表を空にしても失敗する。構文エラー・0件実行は証拠に含めず、実際に1ケース以上が失敗した結果を保存した。
- 型、lint（エラー0。build/dev生成のWorkflow JSに既存警告2件）、production build成功。主要画面のPartial Prerenderを維持した。
- 専用コンテナfw-sales-370-data-e2e / port3373の一時ブラウザーテスト2件（認証準備1件を含む）が成功。画面は暫定定数のFirstwebとして実行し、Bの全行を保護しながらexport / 正常import / 衝突rollback / clear / reset / 元のsnapshot復元まで確認した。B側の操作は実DBテストで実行する。
- Asideで設定画面とReactのDataActionsを確認。Suspense12個のpendingは0。Next全ルートのcompilation issues、ブラウザー接続中のconfigErrors / sessionErrorsは0。

一時specとPlaywright設定は成果物へ退避し、製品に含めない。ブラウザーがローカルcacheから消えていたため対応版を再取得した。日本語を含む通信本文への一致は検証ツール上の文字化けで使えず、ASCIIの応答形と実画面・DBの保存結果を検証した。外部AI・クラウドDBへの書き込みは行わなかった。

## ACTIONと残る境界

#371のDEFAULT削除・複合unique/FK/index、#373のrequest tenant解決は残る。本段階では2社目の運用開始まで完了した扱いにしない。Firstwebの既存seed ID互換を維持するため、IDの完全な振り直しを伴うクローン機能は含めない。

## 今回の知見とルール更新提案

- 【発見した問題・課題】upsertとcascadeは、tenant条件を単純に追加するだけでは他社行を保護できない。
- 【解決した方法】conflict更新のWHEREと更新件数を検査し、transaction全体を戻す。削除前には旧cross-tenant参照も拒否する。
- 【推奨するルール追加・更新】一括移送のテストは先行した正常変更のrollbackも確認する。運用CLIに暗黙tenantを置かず、全体検証の例外は対象と理由を明記する。
- 【次回同様のタスクで参照すべき情報】本書、tenant-data-isolation.integration.test.ts、tenant-cli.integration.test.ts、tenant-args.test.ts、#371。
- 【次に行うべきこと】本PRをレビュー・取り込み後、#371の制約移行へ進む。
