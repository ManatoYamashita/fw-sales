# Issue 368 商談領域のテナント分離

親: [#365](https://github.com/ManatoYamashita/fw-sales/issues/365) ／ 実装: [#368](https://github.com/ManatoYamashita/fw-sales/issues/368) ／ ガード: [#369](https://github.com/ManatoYamashita/fw-sales/issues/369)

## PLAN

店舗の [PR #385](https://github.com/ManatoYamashita/fw-sales/pull/385)（22d6bab）をレビューした後、「1領域1PR」に従い商談を移す。#385 は未マージのため、そのブランチを base にした後続PRとする。先に #385 をマージしてから base を main に変更する。

参照: AGENTS.md / CLAUDE.md、Issue #368 / #369、店舗移行ドキュメント、Next.js 16.3.1 bundled docs（use cache / cacheTag / updateTag）、Supabase / Postgres / Drizzle の公式資料。新規依存・スキーマ変更はない。

- [x] deal / handoff の未束縛入口を削除し、通常・transaction の双方に tenantId を渡す
- [x] 全メソッドの読み書きにテナントを適用する
- [x] 店舗・商談の参照先と営業担当の所属を検証する
- [x] 一覧・KPI・ダッシュボード・アクションキュー・件数・エクスポートの呼び出しを移す
- [x] 実DBの全メソッド対象表と、アクション層の伝播テストを追加する
- [x] 分離条件削除・対象表を空にする反証を確認する
- [x] build と実行時の最終確認を記録する

## DO

`repos.forTenant(tenantId).deal` / `.handoff` が商談領域の入口になる。`Repos` / 未束縛の `TxRepos` の deal / handoff と、`dbDealRepo` / `dbHandoffRepo` を削除する。ファクトリ第2引数は必須で、transaction にも同じ ID を束縛する。

一覧（storeId 指定・未指定）、get、getByDealId、更新前の取得、UPDATE、DELETE に tenant_id 条件を適用する。INSERT は DEFAULT を使わず tenant_id を明示する。他社の ID に対する取得・更新は null、削除は false を返す。更新時は対象の存在確認を先に行うため、不正な参照先を含む PATCH でも他社 ID と不存在 ID の応答は同じになる。

商談の作成・参照先更新では、store_id が同じテナントの店舗であることを検証する。営業担当は memberships の (tenant_id, user_id) で検証し、複数テナントに所属するユーザーも受け入れる。Action 層でも同じ所属を確認する。

引き継ぎの作成・参照先更新では、商談と店舗の tenant_id に加え、商談の store_id と引き継ぎの store_id の一致を確認する。別テナントの店舗・商談も、同じテナント内で組み合わせが違う参照も拒否する。

更新は PATCH の指定列だけを SET し、undefined を未指定、null を明示的な解除として扱う。tenant_id / id / created_at の追加プロパティは除外する。取得した全行を再保存しない。

店舗段階で引数に追加した tenantId を、商談・引き継ぎのクエリの実DB入口まで渡す。KPI、ダッシュボード、アクションキュー、ナビ件数、設定の件数、既存エクスポートも同じ入口を使う。既存のテナント付きキャッシュキー・タグを維持する。

## CHECK

| 検証 | 対象 |
| --- | --- |
| 型・構築ガード | 未束縛入口の削除、通常・transaction の tenantId と executor の一致 |
| 実DBの対象表 | deal 5 / handoff 6 の実メソッドと keyof・Object.keys を照合。空表を拒否 |
| 実DBの分離 | A/B の一覧、他社ID・不存在ID、更新・削除、商談削除の cascade 後も B の全行が不変 |
| 明示的な所属 | transaction 内で tenant_id DEFAULT を外し、INSERT の所属を実行後に確認 |
| 参照先・担当 | 他社・不存在の参照と担当者を拒否。同じ所属と兼務ユーザーを受け入れる |
| 集計 | 商談・引き継ぎのクエリ、KPI、ダッシュボード、アクションキュー、パイプライン、非表示メニュー有効時の件数 |
| Action | Firstweb 以外の tenantId を伝播。他社IDと不存在IDの同じ応答、書き込み・失効をしないこと |

集計の実DBテストでは next/cache の実行環境を mock にし、repository を fixture の実 transaction に接続する。キャッシュのランタイム自体を実DBテストで再現した扱いにはしない。タグの静的検査と Next.js build / 実行時確認を併用する。

ローカル検証:

```bash
pnpm typecheck
pnpm lint
DATABASE_URL=postgresql://test:test@localhost:5432/test pnpm test
APP_ENV=local DATABASE_URL='<migration済みの専用DB>' DATABASE_POOL_MAX=1 pnpm test:integration
```

通常テストは207ファイル・4,853件、実DBは6ファイル・50件成功。型検査とlintも成功した。実DB fixture は毎回 ROLLBACK し、クラウド環境への書き込みは行わない。

| 反証 | 変更時 | 復元後 |
| --- | --- | --- |
| deal.get の tenant 条件を削除 | 終了コード1 | 同じケースが0 |
| handoff.getByDealId の tenant 条件を削除 | 終了コード1 | 同じケースが0 |
| deal 対象表を空にする | 網羅性テストが1 | 同じケースが0 |

反証用の変更はすべて復元済み。

### Next.js とブラウザーでの確認

- dev 環境を読み取り専用で使う production build が成功。AI呼び出しは行わず、ビルド専用のダミーキーを使用した。店舗・詳細・登録・設定・KPI・パイプラインなどの Partial Prerender を維持した。
- 専用コンテナ `fw-sales-368-commercial-e2e` を作成し、既存の開発DB・他作業のE2E DBを変更せずに migration / seed を適用した。
- Next.js `/_next/mcp` で全ルートの compilation issues は0件。ブラウザー接続時の configErrors / sessionErrors も0件。
- Asideで認証済みの一覧と詳細を確認。Reactのroot・コンポーネントツリーが取得でき、詳細のSuspense境界9個に未解決の待機状態は0個だった。
- 既存の smoke / sales-status は認証準備を含む6件が成功。営業記録の作成、失注・再アプローチの反映、絞り込み、店舗名の編集を含む。#385で記録したフォーム停止は今回の実行環境では再現しなかったが、#385のheadで再検証した扱いにはしない。
- 追加の一時検証は認証準備を含む3件が成功。専用DBに別テナントの店舗・商談・引き継ぎを実際に作り、実行中アプリのエクスポートに含まれないこと、キャッシュ経由の他社商談IDが不存在IDと同じ応答になり店舗URLへ転送されないことを確認した。fixtureは検証後に削除した。
- 引き継ぎ・KPI・パイプライン・ダッシュボード画面は既存の公開設定で無効。proxyが店舗一覧へ戻すことを確認した。これらの画面操作による作成・完了は未検証であり、処理と集計は実DB・Actionテストで確認した範囲に限定する。

一時的なPlaywright設定・実行時検証用ファイルは成果物側へ退避し、製品コードに含めない。

## ACTION と後続範囲

- #368 は継続中。調査・Workflow、通知・テンプレート・設定・監査・プロフィールの repository は後続PRで移す。未束縛の共通入口もその完了後に撤去する。
- #370: JSON import / reset / clear / seed / 直接SQLの運用スクリプトを移す。既存エクスポートの repository 呼び出しは今回の入口削除に合わせて移した。
- #371: tenant_id の DEFAULT 削除、複合 FK・一意制約・索引を扱う。今回の参照検証はアプリ層の境界であり、直接SQLや所属削除との競合までDB制約で保証したものではない。
- #373 まではテナント解決は Firstweb の定数。2社目を本運用できる状態とは扱わない。

## 今回の知見とルール更新提案

- 【発見した問題・課題】キャッシュのテナント引数だけでは、内部で未束縛 repository を使う集計が他社データを含む。
- 【解決した方法】商談・引き継ぎの入口を型から除去し、クエリまで伝播。2テナントの実DBで集計結果と他社行の不変を確認した。
- 【推奨するルール追加・更新】子行の所属だけでなく、参照する親行と組み合わせも検証する。更新は所属変更を除外し、指定列だけを保存する。
- 【次回同様のタスクで参照すべき情報】本書、tenant-commercial-isolation.integration.test.ts、commercial-actions.tenant.test.ts、店舗移行ドキュメント。
- 【次に行うべきこと】#385 と後続PRの順序を保ってマージし、調査領域へ進む。
