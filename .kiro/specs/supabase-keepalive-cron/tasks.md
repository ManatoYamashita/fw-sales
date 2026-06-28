# Implementation Plan

> 本機能は単一ワークフローファイル（`.github/workflows/supabase-keepalive.yml`）の追加。並列化対象は無く（実装1本＋順次検証）、`(P)` マーカーは付与しない。
> 設計の load-bearing アクションは `DATABASE_URL` 経由の実テーブル読取（`select 1 from app_settings limit 1`）。詳細は design.md / research.md 参照。

- [x] 1. Keep-alive ワークフローの実装
  - `.github/workflows/supabase-keepalive.yml` を新規作成し、既存 `migrate.yml` の作法（日本語ヘッダコメント・`runs-on: ubuntu-latest`・secret 注入・`timeout-minutes`）を踏襲する。
  - トリガを 2 系統定義する: `schedule`（`cron: '0 9 */5 * *'` = 5 日周期、7 日 pause に対し 1〜2 日の余裕）と `workflow_dispatch`（手動実行）。両トリガは同一ジョブを実行する。
  - ジョブで `DATABASE_URL` を環境変数として受け取り、`psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "select 1 from app_settings limit 1;"` を実行する。実テーブル読取とすることで Supabase の "user database activity" 計上を確実化する（書き込みは一切行わない読み取り専用）。
  - `set -euo pipefail` と `ON_ERROR_STOP=1` で、接続失敗・クエリエラーを確実に非ゼロ exit（red）へ変換する。`timeout-minutes` を設定し無応答時の無限ハングを防ぐ。
  - secret（`DATABASE_URL`）は環境変数経由でのみ psql に渡し、平文 echo しない。HTTP/接続結果や所要時間相当の step ログを残し、成否を判別可能にする。
  - 観測可能な完了条件: ファイルが存在し YAML として valid（Actions 上で parse される）。クエリが実テーブルへの読み取り専用であり、変更が `.github/` 配下のみでアプリ実行経路（`app/`・`lib/`・`middleware.ts` 等）に一切触れていないことをレビューで確認できる。secret 値がワークフロー定義・ログに平文出力されていない。
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4, 4.1, 4.3, 4.4, 5.1, 5.2, 5.4, 6.1, 6.2, 6.3, 6.4_
  - _Boundary: Keep-Alive Workflow_

- [ ] 2. 検証
- [ ] 2.1 手動実行による green / 失敗モード確認
  - 前提: GitHub Actions secret `DATABASE_URL` が登録済みであることを確認する（既存 `migrate.yml` が使用しているため通常は登録済み。未登録なら本番 pooler 接続文字列を登録）。
  - マージ後、`workflow_dispatch` でワークフローを手動起動し green になることを確認する。step ログにテーブル読取クエリの成功が出ることを確認する。
  - 失敗モードを確認する: 一時的に無効な接続情報（または secret 欠落状態）を再現して実行し、ジョブが red 終了し GitHub の失敗通知が運用者へ届くことを確認する。検証後は正規 secret に戻す。あわせて失敗 email の到達先（cron ファイル最終変更者）が運用者を含むことを確認する。
  - 観測可能な完了条件: 正常系で Actions 実行が緑、異常系で赤＋失敗通知が確認できる。
  - _Requirements: 2.3, 3.2, 4.1, 4.2, 5.3, 6.3, 7.1_
  - _Depends: 1_
  - _Boundary: Keep-Alive Workflow_

- [ ] 2.2 自動スケジュール実行と pause 不再発の運用観測
  - 直近の自動スケジュール起動が green であることを Actions 履歴で確認する。
  - pause タイマー周期（7 日）を複数回跨ぐ運用期間にわたり、本番 `https://fw-sales.vercel.app/` が無操作起因の自動 pause に陥らず応答し続けることを観測・確認する。
  - 万一 pause が再発する兆候があれば、keep-alive クエリ対象を別の実テーブルへ差し替える（design.md Open Questions / Operational Risks 参照）。
  - 観測可能な完了条件: スケジュール実行が緑であり、複数 pause 周期を跨いで本番が pause しなかったことを運用者が確認できる。
  - _Requirements: 7.2, 7.3, 7.4_
  - _Depends: 2.1_
  - _Boundary: Keep-Alive Workflow_

## Implementation Notes
- Task 1 完了 (feat/supabase-keepalive-cron)。`.github/workflows/supabase-keepalive.yml` を新規追加。
- **設計微修正を適用**: load-bearing クエリを `select 1 from app_settings limit 1` → `select count(*) from app_settings` に変更。実装時の探索で `app_settings` が空(手動シードKVストア)と判明し、`limit 1` では 0 行返却になるため。`count(*)` は内容非依存で常に 1 行返す。
- **ローカル read-only smoke で本番検証済み**: `.env.local` の本番 DATABASE_URL に対し採用クエリを実行 → exit 0 / 1 行 / `keepalive_rows=0` / 137ms。空テーブルでも `count(*)` が 1 行返ることを実証(微修正の妥当性確認)。read-only のため本番無変更、実行自体が keep-alive ping を兼ねた。
- **psql は GitHub Actions ランナー(ubuntu-latest)に同梱**だがローカル macOS には未インストール。ローカル検証は `postgres` npm パッケージで代替した。
- **Task 2.1 (手動 dispatch green / 失敗モード) と 2.2 (運用観測) はマージ後・運用フェーズで消化**。ローカル/PR 段階では完了不可(workflow_dispatch は merge 後、pause 不再発観測は数週間)。
- **follow-up**: 実装 PR / Issue #147 コメントで OQ2(Issue literal の `SUPABASE_URL`/`SUPABASE_ANON_KEY` ではなく既存 `DATABASE_URL` 再利用)を明記し合意を取ること。
- **PR #149 レビュー対応**: cron を `0 9 */5 * *`(5日周期)→ `0 9 * * *`(日次)に変更(scheduler drift 耐性, commit 306a968)。
- **psql→Node 是正(PR #149 マージ後の初回 dispatch で発覚)**: `gh workflow run` 初回実行が `psql: error: could not translate host name "...@..."` で **failure**。原因は libpq の厳格 URI パーサが `DATABASE_URL` のパスワード中特殊文字(@ 等)を host と誤読。ローカル smoke が通っていたのは Node `postgres`(寛容パーサ)を使ったため、psql との差で CI でのみ顕在化した。修正: workflow を `psql` から **Node `postgres` クライアント**(`actions/setup-node@v4` + `npm install --no-save postgres@3.4.9` + inline `node -e`)へ切替。`migrate.yml` も同 `DATABASE_URL` を Node 系で問題なく使えている precedent に整合。ローカルで同一 inline logic を本番 read-only 実行し green(keepalive_rows=0 / exit0 / 213ms)。教訓: **CI で外部接続文字列を使う際、ローカル node クライアントの寛容パースと psql(libpq)の厳格パースの差に注意**。
