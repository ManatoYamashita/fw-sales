# Issue 368 ユーザー領域のテナント分離

親: #365 ／ 実装: #368 ／ 漏えいガード: #369

## PLAN

#393 head `750a9a8` を独立レビューした後、その上に第4段階を積む。#393は23ファイルを3パスで確認し、High / Middle指摘なし。実DB61件の再実行と全7項目のCI成功も確認した。レビュー投稿・マージ操作は行っていない。

参照: baseのAGENTS.md / CLAUDE.md、既存3領域の移行記録、review2、Next.js 16.3.1のuse cache資料、Supabase / Postgresガイド。既存のルールを優先し、新しい依存やDDLは加えない。

- [x] profile / membership / notification / promptTemplate / appSettings / eventLogをテナント必須factoryへ移行
- [x] root repository / root transaction / db singletonを廃止
- [x] Action・Query・認証・監査・keepaliveを移行
- [x] 全メソッドの実DB検証、DEFAULTなしINSERT、反証を実施
- [x] 型・lint・全テスト・build・ブラウザーを検証

## DO

`repos` の公開入口は `forTenant(tenantId)` だけ。全11 repositoryのfactoryで所属を必須にし、通常接続とtransaction接続の両方に同じ所属を束縛する。未束縛のTxRepos型・transaction API・db singleton exportも廃止した。型と実Object.keysの両方で入口を検査する。

profilesは共有の人情報のまま、全5メソッドをmembershipsとのJOINで絞る。membershipの所属引数はfactoryへ移し、同じ人でもテナントごとのroleを返す。担当者選択、営業資産、現在の認証プロフィール、ユーザー管理も束縛した入口を使う。

通知の取得・個別既読・一括既読はtenant_idとuser_idを両方条件にする。宛先があるINSERTは所属を確認し、削除済みなどのnull宛先は従前どおり保持できる。テンプレートは全8メソッドを両条件で絞り、INSERT所有者の所属を確認する。PATCHは許可列に限定し、追加プロパティからid・所属・所有者を変えられない。テンプレートActionは現在の所属も認証する。

設定は所属で取得し、INSERTにも所属を明示する。現行global PKに衝突したupsertはsetWhereで同じ所属だけを更新し、他社のキーなら汎用エラーで止める。

監査は `writeAudit(tenantId, input)` とし、業務処理から所属を渡す。repositoryはINSERTのtenant_idを束縛値で上書きする。削除後・権限拒否の証跡を残すため、actorや対象の現存・所属の参照検証は加えない。専用プール、DBのstatement_timeout、commit後のbest-effort、失敗時のconsole退避を維持し、退避にもtenant_idを残す。監査repositoryを業務transactionには含めない。

keepalive cronは暫定的にFirstwebを明示し、設定画面は現在のテナントの記録だけを読む。`use cache`のtenantId引数と所属付きタグは維持する。

## CHECK

- 通常: 210ファイル・4,883件成功。新規Action10件でBの束縛・本人スコープ・他社IDと不存在の同応答・所属なしの拒否・Bのタグだけの失効を検査した。
- 実DB: 8ファイル・87件成功。今回の26件で6領域の全24メソッドをkeyofと実Object.keysに照合し、対象表の空も拒否する。別社のみのユーザーと兼務者を用意し、Bの所属・通知・テンプレート・設定・監査の全行が変わらないことを比較する。
- 対象4テーブルのtenant_id DEFAULTをtransaction内で外してINSERTを確認した。fixtureは毎回ROLLBACKする。
- 反証6種: profile読取、通知一括既読、テンプレート既定解除、設定upsert、監査INSERTの所属条件を外すと終了1、復元後0。対象表を空にしても終了1、復元後0。反証用変更は全て復元済み。
- 型検査、lint（エラー・警告0）、production build成功。主要画面のPartial Prerenderを維持した。
- 専用ローカルDB `fw-sales-368-user-e2e`、ポート3372で既存E2E8件成功（認証準備1件を含む）。通知の保存・遷移・再試行・一括既読・セッション切れと設定画面を検証した。
- 一時的なブラウザーテスト3件成功（認証準備1件を含む）。同じ人をA/Bへ所属させ、A画面にB通知・テンプレートが出ないこと、A通知の一括既読でB未読が変わらないこと、Aテンプレートの作成・再読込と明示tenant_idをDBで確認した。
- Asideで設定・テンプレートdialogを確認。ReactツリーのSuspense12個はpending0、Next MCPの全ルートcompilation issues / configErrors / sessionErrorsは0。

一時spec・設定は成果物へ退避し製品に含めない。ビルドと全テストを同時に実行した際の既存ソース走査テストの時間切れは、ビルド完了後に全テストを2 workerで実行して成功した。製品のタイムアウト設定は変えていない。外部AI・クラウドDBへの書き込みは行わない。

## ACTION と残る境界

全4領域のrepository移行をhead上で実装した。#393と本PRの順で取り込み、Issueの完了判定はmainへの反映後に行う。

#370の直接SQL・import / reset / seedと、#371のDDLが残る。この段階は複数社運用開始の完了を意味しない。特に以下は意図的に未変更:

- app_settingsのglobal PKは同じkeyを2社で保持できない。衝突時は他社を書き換えず失敗する。#371では複合unique追加とrepositoryのconflict target変更を段階的に行う。
- テンプレートの既定unique indexと5件上限trigger・advisory lockは現状user_id単位。Bに既定がある兼務者のA側切替は、Bを解除せずunique制約で失敗することをsavepointで検証した。#371でtenant_id × user_id単位へ移す。
- tenant解決とcron対象は暫定定数。#373でリクエストの所属を解決する。旧Workflow deploymentの処理が終了・停止したことも複数社運用前に確認する。

## 今回の知見とルール更新提案

- 【発見した問題・課題】兼務者をuser_idだけで絞ると、通知の一括更新や既定テンプレート解除が他社へ波及する。upsertもWHEREを忘れると他社の設定を更新する。
- 【解決した方法】factoryで所属を束縛し、全read/writeとconflict更新を絞り、実DBとブラウザーで兼務者を検証した。
- 【推奨するルール追加・更新】所属分離の検証には兼務者・一括更新・upsertを必ず含める。監査の所属は業務処理から渡し、専用プールと削除後の証跡保持を守る。
- 【次回同様のタスクで参照すべき情報】本書、tenant-user-isolation.integration.test.ts、user-actions.tenant.test.ts、repository-composition.test.ts、#370 / #371。
- 【次に行うべきこと】#393、本PRを順にレビュー・取り込み後、#370の直接SQL移行へ進む。
