# Research & Design Decisions

## Summary

- **Feature**: `pipeline-sales-filter`
- **Discovery Scope**: Simple Addition(既存 Repository パターン + Cache Components の上に optional フィールドを 1 つ追加する追加変更)
- **Key Findings**:
  - 既存の `StoreFilter` は `q` / `stage` / `priority` / `channel` の 4 フィールドを optional で持ち、DB 実装は `eq()` の蓄積、Mock 実装は早期リターンの連鎖というシンプルな AND 構造で実装されている。`sales` も同パターンに完全に乗る。
  - Pipeline 画面は **KanbanBoard のみ**を描画する(StoreTable は未配置)。要件 2 で当初想定した「StoreTable / KanbanBoard 切替」は実態と乖離しており、要件補正で「KanbanBoard 全ステージカラムの整合性」に書き換えた。
  - `app/(main)/pipeline/page.tsx:13-18` は `searchParams` 型に既に `sales?: string` を宣言しているが、line 22-26 では `filter` に詰めていない。`pipeline-filters.tsx` 側は既に URL に `sales` を書き込んでいる。つまり「UI と URL は接続済み、backend だけが切れている」状態であり、本 Issue の修正は文字通り 4 ファイル合計 4〜5 行の追加で完了する。

## Research Log

### Pipeline 画面の描画構成

- **Context**: 要件 2 の「StoreTable / KanbanBoard 切替」前提が実装と一致しているか確認するため。
- **Sources Consulted**:
  - `app/(main)/pipeline/page.tsx`(本文)
  - `app/(main)/pipeline/_components/`(`kanban-board.tsx`, `pipeline-filters.tsx` のみ)
  - `app/(main)/stores/_components/stores-table.tsx`(StoreTable は `/stores` 画面所有)
- **Findings**:
  - Pipeline 画面は `<PipelineFilters />` + `<KanbanBoard filter={filter} />` のみを描画。表示モード切替なし。
  - StoreTable は `/stores` 画面の専有コンポーネント。
- **Implications**: 要件 2 を「KanbanBoard 全ステージカラムの整合性」に書き換え、Boundary Context の In scope からも `StoreTable / KanbanBoard 両方` を `KanbanBoard 全ステージカラム` に補正。

### 既存フィルタ条件の実装パターン

- **Context**: `sales` 条件追加が既存パターンに整合するか確認。
- **Sources Consulted**:
  - `lib/db/store-repository.ts` `buildFilterConditions`(line 110-132)
  - `lib/mock/store.ts` `matches`(line 8-28)
- **Findings**:
  - DB: `if (filter.X) conditions.push(eq(stores.X, filter.X));` を `stage` / `priority` / `channel` に対して直列に並べ、`q` のみ ILIKE OR 結合。最後に `and(...conditions)`。
  - Mock: `if (filter.X && store.X !== filter.X) return false;` の早期リターン。`q` のみ trim + lowercase + 6 カラム joined haystack。
- **Implications**: `sales` は `stage` / `priority` / `channel` と同じ「単一カラム完全一致」パターンに乗せる。DB は `eq(stores.assigned_sales, filter.sales)`、Mock は `store.assigned_sales !== filter.sales`。`q` のような正規化は適用しない(Issue リスク欄の「表記揺れは弾く」仕様に整合)。

### Cache Components の filter 伝播

- **Context**: filter.sales 追加時に cache key が自動更新されるか、明示的な cacheTag 追加が必要か確認。
- **Sources Consulted**:
  - `app/(main)/pipeline/page.tsx:40-49`(`<Suspense key={JSON.stringify(filter)}>`)
  - `app/(main)/pipeline/_components/kanban-board.tsx:12-16`(`'use cache'` + `cacheTag(CACHE_TAGS.stores, CACHE_TAGS.pipeline)`)
  - `lib/cache.ts`(`CACHE_TAGS` 定数)
- **Findings**:
  - `'use cache'` 関数の cache key は引数(filter)から自動的に派生。filter に `sales` が増えても自動で別キーになる。
  - Suspense `key={JSON.stringify(filter)}` がフィルタ変更時にバウンダリを完全再生成し、新しいキャッシュエントリを取得。
  - `CACHE_TAGS.stores` / `CACHE_TAGS.pipeline` は両方とも store 編集系の Server Action から `revalidateTag` される(`store-actions.ts` 等)ため、データ変更時の整合性は維持される。
- **Implications**: `sales` 追加にあたり cacheTag・cache key の追加変更は不要。既存戦略にそのまま乗る。

### 担当者マスタの取り扱い

- **Context**: `sales` フィルタ値の検証ロジック要否を判断。
- **Sources Consulted**:
  - `lib/domain/staff.ts`(`SALES` 配列、`pipeline-filters.tsx` から参照)
  - `types/store.ts:41`(`assigned_sales: string`)
- **Findings**:
  - `SALES` は静的配列で、UI ドロップダウン選択肢として使われている。
  - `Store.assigned_sales` は単純文字列。マスタ ID 化されていない(Issue のリスク欄が指摘の通り)。
- **Implications**:
  - PipelinePage では `SALES` との照合検証を行わない。理由: 担当者マスタ正規化を Out of Boundary としているため(Req 4.2, 4.4)、未登録値は「該当無し」(空集合)として自然に扱う仕様にする。
  - `priority` の詰替え時に `(PRIORITIES as readonly string[]).includes(sp.priority)` で列挙検証している既存パターンとは差別化する設計判断(下記 Design Decisions 参照)。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| **採用: 既存パターン踏襲(単一カラム完全一致)** | `stage` / `priority` / `channel` と同様、DB は `eq()`、Mock は `===` で蓄積 | 学習コストゼロ、Diff 最小、レビュー容易、Repository 切替時も自動対応 | 表記揺れに不寛容(設計上の意図) | Issue 4 ステップに 1:1 対応 |
| 列挙検証付き(SALES 照合) | `priority` のように `if (sp.sales && SALES.includes(sp.sales)) filter.sales = sp.sales as Sales` | URL 直叩きでの不正値を弾ける | マスタ確定前の段階で型強化するとマスタ更新時の更新コスト増。"未登録担当者値は空集合" の仕様意図を阻害 | 棄却 |
| 表記揺れ正規化(trim + lowercase) | `q` のように normalize して比較 | UX 改善 | Out of Boundary に明記済み(担当者マスタ ID 化までの暫定運用)。本 Issue ではスコープ膨張 | 棄却 |
| 担当者マスタ ID 化 | `sales: string` を `sales_id: SalesId` に置換 | 表記揺れ根絶、FK 整合 | `auth-and-notifications` 後続 Issue の主スコープ | 後続で対応(Revalidation Triggers) |

## Design Decisions

### Decision: フィルタ値の検証は最小化(SALES 照合をしない)

- **Context**: `priority` の詰替えでは `PRIORITIES.includes(sp.priority)` で列挙検証している。`sales` も同様にすべきか。
- **Alternatives Considered**:
  1. `SALES.includes(sp.sales)` で列挙検証し、未登録値は filter に詰めない
  2. 検証なしで素通し(未登録値は「該当無し」として自然に処理)
- **Selected Approach**: 2(検証なし素通し)
- **Rationale**:
  - Req 4.4 の「ID 移行を本機能で先行させない」方針と整合。`SALES` をハードコードのソース・オブ・トゥルースとして扱い始めると、後続の担当者マスタ DB 化時に PipelinePage 側のロジック書き換えが追加で必要になる。
  - Req 1.4 の「完全一致のみ、表記揺れは弾く」と整合。未登録値は空集合になるだけで、エラーや警告を出す必要はない。
  - Diff を最小化(Issue 工数 0.5 人日に整合)。
- **Trade-offs**:
  - メリット: マスタ更新時に PipelinePage を触らずに済む。型強度が低い分、変更耐性は高い
  - 妥協: URL 直叩きで未登録値を入れた利用者は「全件表示にならず空集合になる」という挙動を見る。社内ツール想定なので許容
- **Follow-up**: 担当者マスタ DB 化(後続 Issue)時に、`sales` の意味論を ID ベースに置換する設計を別途行う

### Decision: `lib/repositories/store-repository.ts` interface ファイルは無修正

- **Context**: `StoreFilter` を拡張するときに interface ファイルも触るべきか。
- **Alternatives Considered**:
  1. interface ファイルにコメントを追加(`/** sales 対応 */` 等)
  2. 完全無修正(型レベル追従に任せる)
- **Selected Approach**: 2(無修正)
- **Rationale**:
  - interface のシグネチャは `list(filter?: StoreFilter)` で `StoreFilter` を不透明に参照するだけ。型拡張で自動追従する。
  - 不要なファイルへの diff を避けることで、レビュー範囲を最小化(File Structure Plan の Modified 4 ファイルに集中させる)。
  - structure.md の方針「DB 切替の単一窓口は `lib/repositories/index.ts`」とも整合(interface に説明的コメントを追加するのは責務外)。
- **Trade-offs**: 特になし
- **Follow-up**: なし

### Decision: 自動テストフレームワーク導入は本 Issue で行わない

- **Context**: 受入基準を継続的に守る仕組みとして自動テストを入れるべきか。
- **Alternatives Considered**:
  1. Vitest + React Testing Library を本機能と併せて導入
  2. プロジェクト方針(tech.md「自動テストフレームワーク未導入」)に従い、手動検証 + typecheck/lint/build のみ
- **Selected Approach**: 2(プロジェクト方針踏襲)
- **Rationale**:
  - Issue 工数 0.5 人日とテスト基盤導入はスケールが合わない
  - tech.md と AGENTS.md の方針を変えるのは別の意思決定が必要
- **Trade-offs**: 回帰テストは手動依存。受入基準の自動再検証は未保証
- **Follow-up**: 別途テスト基盤導入 Issue を立てる場合は、本機能のマニュアル検証項目を流用できる

## Risks & Mitigations

- **Risk: 担当者表記揺れによるユーザー体験の悪化** — `assigned_sales` への登録時に表記が揺れると(マスタ未確定のため避けがたい)、ドロップダウン選択でも該当無しになる可能性
  - **Mitigation**: 担当者マスタ ID 化(後続 Issue)で根絶。本機能では Issue リスク欄の通り「弾く」仕様として明記
- **Risk: Mock と DB の挙動不一致** — `eq()` (SQL) と `===` (JS) で文字列比較の細部が異なる可能性(例: 同形異字、半角/全角)
  - **Mitigation**: 両者とも文字列の素な等値比較で「全く同じ文字列のみ一致」を意図しているため、現実的な不一致は無い。マニュアル検証項目に「Mock / DB 一貫性」を含める
- **Risk: filter.sales を将来 ID 型に変える際の他箇所影響** — `StoreFilter` を消費する箇所が増えると ID 化時の影響範囲が膨らむ
  - **Mitigation**: 本機能では Pipeline 画面のみで filter.sales を消費。Out of Boundary を明示、Revalidation Triggers に「`stores.assigned_sales` の型変更」を記載

## References

- GitHub Issue: https://github.com/ManatoYamashita/fw-sales/issues/5
- `.kiro/steering/structure.md`: Repository パターンと依存方向の規定
- `.kiro/steering/tech.md`: Cache Components 戦略・自動テスト未導入方針
- `app/(main)/pipeline/_components/pipeline-filters.tsx`: URL `sales` 書き込みの既存実装(無修正前提)
- `lib/db/store-repository.ts:110-132`: `buildFilterConditions` パターン参照元
- `lib/mock/store.ts:8-28`: `matches` パターン参照元
