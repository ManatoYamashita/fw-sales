# Implementation Plan

## Plan Summary

`StoreFilter` に optional な `sales?: string` を 1 つ追加し、その値を DB / Mock 双方の Repository と Pipeline ページの 3 箇所に伝播させる Simple Addition。Foundation で型を拡張、Core で 3 ファイルを並列に編集、Validation で型・Lint・Build と design.md の Manual Verification 13 項目を消化する。新規依存・新規パターン・スキーマ変更は無い。

## Tasks

- [x] 1. StoreFilter 型に営業担当絞り込みフィールドを追加する
  - 既存 optional フィールド(`q` / `stage` / `channel` / `priority`)と同じ慣習で `sales?: string` を追加する
  - JSDoc コメントで「`assigned_sales` カラムと厳密一致(`eq()` / `===`)で比較する」「表記揺れ正規化や ID 化は本機能の対象外」「将来の担当者マスタ ID 化までは文字列のまま保持する」ことを明記する
  - 完了状態: 拡張後に `pnpm typecheck` を実行すると、既存の `StoreFilter` 利用箇所(Repository 実装 2 箇所・Pipeline ページ・他フィルタ消費画面)で型エラーが発生せず通過する
  - _Requirements: 1.1, 1.4, 4.2, 4.4_
  - _Boundary: types/store_

- [x] 2. Pipeline 画面の sales フィルタを URL から backend まで接続する

- [x] 2.1 (P) DB Repository の WHERE 構築に sales 等価条件を追加する
  - `buildFilterConditions` 内で `stage` / `priority` / `channel` と並列の位置(`q` 条件より前)に `if (filter.sales) conditions.push(eq(stores.assigned_sales, filter.sales));` 形式の 1 行を追加する
  - 空文字は `if (filter.sales)` の falsy 判定で自動的に条件追加スキップとなり、未指定と同じ挙動になることを確認する
  - 完了状態: `/pipeline?sales=<担当者名>` でアクセスしたとき DB クエリの WHERE に `assigned_sales = '<担当者名>'` 相当の条件が 1 つ追加され、未指定時は WHERE 句に `assigned_sales` 関連 SQL が含まれない
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 3.1, 4.2_
  - _Boundary: lib/db/store-repository_
  - _Depends: 1_

- [x] 2.2 (P) Mock Repository の判定関数に sales 等価条件を追加する
  - `matches` 関数の早期リターンチェーンに `if (filter.sales && store.assigned_sales !== filter.sales) return false;` を追加する。位置は他フィールドの早期リターンと並列(`q` 条件より前)
  - DB 実装と挙動が一致するよう、文字列正規化(trim・lowercase 等)を一切適用しないことを確認する
  - 完了状態: Mock モードで `filter.sales` 指定時に `assigned_sales` が一致しない店舗が `return false` で除外され、未指定時は当該分岐を通過して他フィルタ評価に進む
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 3.1, 4.2_
  - _Boundary: lib/mock/store_
  - _Depends: 1_

- [x] 2.3 (P) Pipeline ページで searchParams から filter.sales を詰替え、暫定 TODO コメントを撤去する
  - `searchParams` 詰替えブロックに `if (sp.sales) filter.sales = sp.sales;` を追加する(空文字は falsy で除外、`SALES` マスタとの列挙照合は行わない)
  - line 27 相当の「sales フィルタはクライアント側カラム表示後に絞り込む(KanbanBoardでは未対応 → 後日)」コメントをファイルから削除する
  - 既存の `<Suspense key={JSON.stringify(filter)}>` を温存し、フィルタ変更時に KanbanBoard 全カラムが同時再描画される挙動を保つ
  - 完了状態: `/pipeline?sales=<値>` で `filter.sales` が当該値に設定された状態で `<KanbanBoard filter>` に渡される / `git grep "sales フィルタ.*後日" app/\(main\)/pipeline/page.tsx` の結果が空 / `<Suspense>` の `key` 構造に変更が無い
  - _Requirements: 1.1, 1.2, 1.3, 3.3, 4.3_
  - _Boundary: app/(main)/pipeline/page_
  - _Depends: 1_

- [x] 3. ビルド検証と Manual Verification を実施する

- [x] 3.1 Type / Lint / Build を 3 コマンドで通す
  - `pnpm typecheck`: `StoreFilter` 拡張で他箇所(Repository interface・他画面の filter 消費)に副次的型エラーが発生していないことを確認
  - `pnpm lint`: ESLint(`next/core-web-vitals` + `eslint-config-next/typescript`)で警告・エラーともに無し
  - `pnpm build`: Next.js 本番ビルドが Cache Components の cache key 整合を含めて成功(`'use cache'` のキー導出が新フィールドで破綻しない)
  - 完了状態: 3 コマンドすべて exit 0 で完了し、追加の型エラー・lint 違反・build エラーが残らない
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 4.1, 4.2, 4.3_
  - _Depends: 2.1, 2.2, 2.3_

- [x] 3.2 design.md の Manual Verification 表 13 項目をブラウザで消化する
  - Req 1 系(6 項目): UI 選択 → URL 反映 / URL 直接アクセス / sales 未指定で全件 / sales=空文字で全件 / 大文字小文字差で除外 / 前後空白差で除外
  - Req 2 系(2 項目): カラム件数・空状態メッセージへのフィルタ反映 / sales 変更時の全カラム同時再描画
  - Req 3 系(3 項目): 他フィルタとの AND / sales 未指定時の既存挙動不変 / フィルタ解除で URL から `sales` クエリ除去
  - Req 4 系(2 項目): `/stores` 画面のフィルタ動作不変 / `git grep` で TODO コメント撤去確認
  - 完了状態: design.md の Manual Verification 表 13 行すべてが「期待結果」と一致し、未消化項目が残らない
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 4.1, 4.2, 4.3_
  - _Depends: 3.1_

## Implementation Notes

- **2026-05-10 worktree env setup**: `EnterWorktree` で作成された worktree は `node_modules` も `.env.local` も持たない。kiro skill が DB 接続を伴う build/typecheck を必要とする場合、`pnpm install --prefer-offline` と親リポジトリからの `.env.local` 複製の 2 ステップが事前に必要。次回以降の同種 Issue でも参照すること。
- **DB Repository / Mock Repository の挙動一貫性**: `eq(stores.assigned_sales, filter.sales)` (Drizzle, Postgres) と `store.assigned_sales !== filter.sales` (JS) はいずれも文字列の素な等値比較で、表記揺れ(全角半角・前後空白・大小文字)を吸収しない。これは Req 1.4 の意図(完全一致のみ)に整合する設計判断。担当者マスタ ID 化(`auth-and-notifications` 系列の後続 Issue)で根絶される予定。
- **検証戦略**: typecheck + lint + build の 3 コマンドはコード正当性のみを担保する。受入基準(Req 1〜4)の充足は Task 3.2 の Manual Verification(13 項目, ブラウザ操作)に完全に委ねられている。`pnpm dev` 起動 → `/pipeline?sales=...` でユーザー自身が消化することが必須。
