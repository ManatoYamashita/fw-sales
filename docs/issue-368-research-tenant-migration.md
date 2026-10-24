# Issue 368 調査領域のテナント分離

親: #365 ／ 実装: #368 ／ 漏えいガード: #369

## PLAN

#385（店舗）、#392（商談）をこの順にマージした main の `06c21a4` を起点に、調査を独立したPRで移行する。参照した規則は AGENTS.md / CLAUDE.md、店舗・商談の移行記録、Next.js 16.3.1 と Workflow 5.0.0-beta.38 の同梱資料、Supabase / Postgres のガイド。

- [x] researchRun の通常・transaction の入口をテナント必須化
- [x] 全9メソッドの分離、依頼者と店舗の所属検証、INSERT の所属明示
- [x] 調査一覧、件数、レビュー、進捗、営業資産の呼び出しを移行
- [x] Workflow と各DB step、実行基盤同期へ tenantId を明示的に引き継ぐ
- [x] 実DB全メソッド、Workflow / Action、反証、build、ブラウザーを検証

## DO

入口は `repos.forTenant(tenantId).researchRun`。未束縛の `Repos.researchRun` / `TxRepos.researchRun` / `dbResearchRunRepo` を削除する。ファクトリ第2引数は必須で、transaction の接続にも同じテナントを渡す。

get、getForUpdate、店舗別の最新・履歴、レビュー待ちの店舗ID、件数、UPDATE と updateIfRunning に tenant_id 条件を適用する。create は同じテナントの店舗と、null または同じテナントの依頼者だけを受け付ける。INSERT に tenant_id を明示する。

update は既存の行ロックを使うレビューの契約を維持する。許可した列だけを更新し、undefined を無視する。id、tenant_id、store_id、requested_by_user_id、開始・期限は追加プロパティでも変更できない。Workflow の書き込みは引き続き `status = running` の CAS のみで、終了した調査を復活させない。

Workflow は `start(storeResearchWorkflow, [runId, storeId, tenantId])` で起動する。店舗読取、段階更新、出典保存、成功保存、失敗保存の各DB stepに tenantId を渡す。step内でリクエストのテナントを解決しない。実行基盤IDの記録と進捗の突き合わせも tenantId 必須にし、未束縛の既定repositoryを使わない。

調査一覧・バッジ・店舗一覧のレビュー状態・設定の件数と調査詳細まで伝播する。営業資産の店舗保存は店舗段階で分離済み。今回は営業担当の表示名も memberships の (tenant_id, user_id) で引く。

## CHECK

- 通常テスト: 209ファイル・4,873件成功。新規にWorkflow伝播5件、他社IDを扱うAction5件を追加。
- 実DB: 7ファイル・61件成功。調査9メソッドを keyof・実 Object.keys と照合し、対象表の空も拒否する。2テナントの同名店舗と調査を用意し、他社の取得・更新、件数、レビュー待ち、担当者、CAS、他社全行の不変を検証した。
- DEFAULTをtransaction内で外してINSERTを実行。依頼者は同じ所属・兼務者・nullを受け入れ、他社・不存在を拒否した。fixture は毎回ROLLBACKする。
- 反証: get / updateIfRunning の tenant 条件を1か所ずつ削除すると終了1、復元後の同じケースは0。対象表を空にしても終了1になる。反証用変更は復元済み。
- 型検査・production buildが成功。lintはエラー0、Workflowが生成する既存JSのunused disable警告2件。主要画面のPartial Prerenderを維持した。
- 専用コンテナ `fw-sales-368-research-e2e` で調査レビューの既存E2E9件が成功（認証準備1件を含む）。却下、候補採用、編集採用、完了操作の表示、小画面・低い画面を確認した。
- 一時的なローカル検証routeから実際のSDKでコンパイル済みWorkflowを起動。テナントBにAの店舗IDを渡すと外部調査へ進まず、Bのrunだけがfailedになり、Aの全runは不変だった。外部AIのキーを検証用サーバーから除去し、AIを呼ばずに確認した。
- Next.js全ルートの compilation issues と、ブラウザー接続中の configErrors / sessionErrors は0件。Asideで調査一覧・詳細とReactツリーを確認し、Suspense境界11個の未解決状態は0個だった。

一時検証用route・Playwright設定・specは成果物側へ退避し、製品コードに含めない。AIの生成品質や外部API成功まで検証した扱いにはしない。クラウドDBへの書き込みは行わなかった。

## ACTION とデプロイ時の境界

導入済みWorkflow SDKの `foundations/versioning.mdx` に従い、既存runは開始時のdeploymentに固定される。新規runから3引数を使い、テナントのない引数はFirstwebへ補完せず停止する。古いrunの入力をそのまま「最新で再実行」する操作は互換ではない。再実行する場合は所属を検証して新しい入口から開始する。

#373で複数社のルーティングを有効にする前に、古い未束縛コードで動くrunの完了・停止を確認する。今回、稼働中のクラウドrunを変更・キャンセルしてはいない。

ユーザー関連repository（profiles / notifications / ai_prompt_templates / app_settings / event_logs）は後続。#370のimport・reset・seed・直接SQL、#371のDEFAULT削除と複合制約も残る。現在のテナント解決は定数のため、2社目の運用開始条件を満たした扱いにしない。

## 今回の知見とルール更新提案

- 【発見した問題・課題】バックグラウンド処理でテナントを解決すると、起動時の所属を保持できない。
- 【解決した方法】Workflow起動引数からすべてのDB stepと失敗記録まで明示的に引き継いだ。
- 【推奨するルール追加・更新】非同期処理には所属を起動時に渡し、暗黙の既定テナントを置かない。再実行の入力互換性と旧deploymentのrunも移行条件に含める。
- 【次回同様のタスクで参照すべき情報】本書、tenant-research-isolation.integration.test.ts、store-research.tenant.test.ts、research-actions.tenant.test.ts、Workflow同梱のversioning資料。
- 【次に行うべきこと】調査PRをレビューし、ユーザー領域の移行へ進む。
