# Requirements Document

## Project Description (Input)

GitHub Issue: https://github.com/ManatoYamashita/fw-sales/issues/5

### 背景・目的

- **対象ユーザー**: 営業担当者(フリーザ軍の現場戦士)。Pipeline 画面 (`/pipeline`) で自分または特定担当者の案件のみを抽出して見たい者。
- **現状**: Pipeline 画面の「営業担当」フィルタは UI 上に存在し、`pipeline-filters.tsx` から URL クエリ `sales` に書き込まれる。しかし `types/store.ts` の `StoreFilter` 型に `sales` プロパティが無いため、backend (`lib/db/store-repository.ts` および `lib/mock/store.ts`) には伝わらず、絞り込みが実際には効かない。`app/(main)/pipeline/page.tsx:27` には「sales フィルタはクライアント側カラム表示後に絞り込む(KanbanBoardでは未対応 → 後日)」と暫定対応のコメントが残っている。
- **変えたいこと**: `StoreFilter` に `sales` を追加し、Repository(DB / Mock 双方)で絞り込みを実施。Pipeline ページから `sp.sales` を `filter.sales` に詰めることで、URL パラメータが backend で実際に効き、StoreTable と KanbanBoard の両方が一貫してフィルタ済みデータを受け取れる状態にする。

### 工数目安・ロードマップ

**0.5 人日** / Wave 2: UX 強化

## Introduction

Pipeline 画面の「営業担当」フィルタは UI 上で選択でき URL にも反映されるが、データ取得層がクエリを認識しないため、実際には店舗の絞り込みが行われていない。現状は一部の表示モードで「クライアント側カラム表示後に後付けで絞り込む」暫定実装で凌いでおり、KanbanBoard モードでは絞り込みが効かないという表示形式間の不整合が残っている。

本機能では、URL クエリ `sales` を backend のフィルタ層まで一気通貫で伝播させ、Pipeline 画面の KanbanBoard 全ステージカラムが同一のフィルタ済み結果を表示するようにする。担当者マスタの正規化や Stores 一覧画面のフィルタ拡張は本機能の対象外とし、後続 Issue で扱う。

## Boundary Context

- **In scope**:
  - Pipeline 画面 (`/pipeline`) の「営業担当」フィルタを backend で実際に効かせる。
  - KanbanBoard の全ステージカラムで同一のフィルタ済み店舗集合を扱う。
  - 各ステージカラムの件数表示・空状態メッセージへのフィルタ反映。
  - 既存フィルタ(ステージ / チャネル / 検索語等)との AND 組合せ。
  - コードに残る「sales フィルタ → 後日」相当の暫定 TODO コメントの解消。
- **Out of scope**:
  - Stores 一覧画面 (`/stores`) や他画面のフィルタ仕様変更。
  - 担当者の表記揺れ正規化(全角/半角、前後空白、大文字小文字)。
  - 担当者マスタ ID 化(文字列 → FK)。
  - 営業担当の複数選択 UI(本機能は単一値選択を前提とする)。
  - 担当者マスタの新規作成・編集 UI。
- **Adjacent expectations**:
  - 担当者マスタ化を扱う後続 Issue(`auth-and-notifications` 系列)が完了したタイミングで、本フィルタは ID ベースに置き換わる前提。本機能はその差し替えを阻害しない形で文字列ベースのまま完了する。
  - URL クエリキー `sales` は本機能内で確定し、既存ブックマークとの互換性を保つ。

## Requirements

### Requirement 1: 「営業担当」フィルタの backend 適用

**Objective:** As a 営業担当者, I want Pipeline 画面の「営業担当」フィルタが backend で実際に絞り込みを行うこと, so that 自分または特定担当者の店舗だけを視野に入れて作業できる

#### Acceptance Criteria

1. When 利用者が Pipeline 画面の「営業担当」フィルタで担当者を選択する, the Pipeline 画面 shall 選択値を URL クエリ `sales` に反映し、当該担当者が割り当てられた店舗のみを結果に含める
2. When URL に `?sales=<担当者名>` が直接指定された状態で Pipeline 画面が読み込まれる, the Pipeline 画面 shall 当該担当者が割り当てられた店舗のみを結果に含める
3. While `sales` フィルタが指定されていない、または値が空文字である, the Pipeline 画面 shall 営業担当による絞り込みを行わず、他フィルタの条件のみで結果を返す
4. If `sales` の値が登録されている担当者の値と完全一致しない (前後空白・全角半角・大文字小文字の差異を含む), then the Pipeline 画面 shall 当該店舗を結果に含めない

### Requirement 2: KanbanBoard 全カラムでのフィルタ整合性

**Objective:** As a 営業担当者, I want KanbanBoard の全ステージカラムが営業担当フィルタを反映した状態で揃うこと, so that 一部のカラムだけ絞り込まれているような表示の食い違いを発生させない

#### Acceptance Criteria

1. The Pipeline 画面 shall KanbanBoard の全ステージカラムに表示する店舗を `sales` フィルタ適用後の集合に限定する
2. While `sales` フィルタが適用されている, the Pipeline 画面 shall 各ステージカラムの件数表示および空状態メッセージにフィルタ適用後の件数を反映する
3. When 利用者が `sales` フィルタを変更または解除する, the Pipeline 画面 shall すべてのステージカラムを同時に再描画し、新旧の表示が混在する状態を残さない

### Requirement 3: 他フィルタとの組合せ

**Objective:** As a 営業担当者, I want 「営業担当」フィルタを既存フィルタ(ステージ / チャネル / 検索語など)と組み合わせて使えること, so that より細かい条件で対象店舗を抽出できる

#### Acceptance Criteria

1. When 利用者が `sales` と他のフィルタ(ステージ / チャネル / 検索語等)を同時に指定する, the Pipeline 画面 shall すべてのフィルタを AND 条件で適用した結果を表示する
2. When 利用者が `sales` を未指定にして他のフィルタのみ操作する, the Pipeline 画面 shall 既存フィルタの動作を従来と同一に保つ
3. When 利用者が「営業担当」フィルタを解除する, the Pipeline 画面 shall URL から `sales` クエリを除去し、残りのフィルタ条件のみで絞り込みを行う

### Requirement 4: スコープ境界と暫定実装の解消

**Objective:** As a プロダクトオーナー兼メンテナ, I want 本機能の対象範囲を明示した上でコードに残る暫定 TODO を解消すること, so that スコープ膨張と仕様/実装の乖離を同時に防げる

#### Acceptance Criteria

1. The 営業担当フィルタ shall Pipeline 画面のみを対象とし、Stores 一覧画面や他画面のフィルタ仕様を本機能の変更対象としない
2. The 営業担当フィルタ shall 文字列の完全一致で動作し、表記揺れ正規化や担当者マスタ ID 化を本機能の範囲外として扱う
3. The Pipeline 画面 shall コード上の「sales フィルタはクライアント側…後日」相当の TODO コメントを除去した状態で完了する
4. While 担当者マスタ化の後続 Issue が未完了である, the 開発チーム shall 本フィルタの値を文字列のまま保持し、ID 移行を本機能内で先行させない
