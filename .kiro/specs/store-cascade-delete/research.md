# Gap Analysis: store-cascade-delete

- 実施日: 2026-07-04
- 入力: `requirements.md`(5 要件)、コードベース調査、**本番 Supabase の読み取り専用実測**(pg_constraint / pg_tables / drizzle.__drizzle_migrations への SELECT のみ)
- 参照 Issue: [#152](https://github.com/ManatoYamashita/fw-sales/issues/152)

## 1. 調査サマリ

1. **決定的事実(本番実測)**: 本番 DB の `deals.store_id` / `research.store_id` / `handoffs.store_id` / `handoffs.deal_id` の FK には **`ON DELETE` 句が無い(= NO ACTION)**。migration `0015_store_cascade_delete` は**本番に未適用**。Issue #152 の「紐づけデータがあると削除がブロックされる」は本番の実挙動として正しい(SQLSTATE 23503 → 「関連レコードに紐づいているため削除できませんでした…」トースト)。
2. **未適用の機構**: drizzle-orm migrator は「最終適用行の `created_at`(水位線)より新しい `folderMillis` のみ適用」する。本番台帳は 0016(2026-06-08)以降が適用された時点で水位線が 0015(2026-06-06)を追い越し、**0015 は今後の `db:migrate` でも永久にスキップされる**。0013 / 0014 も同様に未適用(ただし対象テーブル `research_jobs` は 0017 で DROP 済みのため実害なし)。
3. **アプリ層は要件の大半を既に充足**: 削除ガードは存在せず、schema/actions/確認ダイアログ(3 経路)/エラー二系統設計/一括削除の部分結果通知まで実装済み。欠けているのは (a) **本番 FK 制約の是正**(Req 5)と (b) **ダイアログのデータ駆動化**(Req 3。現行はハードコード固定文で、廃止済み「Deep Research」の文言まで残存)。
4. **「全環境」の実態は単一 DB**: ローカル `.env.local` も本番 Supabase 直結のため、cascade 削除は 0015 マージ以降どの環境でも一度も機能していない。是正は 1 つの DB への 1 回の適用で完結する。
5. 既存 CI 機構(`migrate.yml` + `check-migrations.yml`)は新規 migration 0021 をそのまま安全に適用できる(0016〜0020 は同機構で正常適用済みと台帳から確認)。

## 2. 現状資産マップ

| 資産 | 場所 | 要点 |
|---|---|---|
| 単体削除 action | `lib/actions/store-actions.ts:259-288` | `repos.store.delete` → 23503 は parse→構造化ログ→UI 文言分離。成功時 `redirect("/stores")` |
| 一括削除 action | `lib/actions/store-actions.ts:300-350` | 単発 `DELETE ... WHERE id IN` 。deletedCount/requestedCount を返す |
| Repository 実装 | `lib/db/store-repository.ts:212-240` | `RETURNING id` で削除判定。**単発 DML の暗黙 transaction で原子性確保**。明示 transaction wrap は Transaction Pooler 非互換(`UNSAFE_TRANSACTION`)のため PR #144 で撤回済み — 再導入禁止 |
| Repository IF | `lib/repositories/store-repository.ts` | `delete` / `bulkDelete` のみ。**影響件数取得メソッドは無い**。Mock 実装は撤去済み(`repos` は `lib/db` 直結 singleton) |
| Drizzle schema | `lib/db/schema.ts:154,192,234,238,348-350` | deals/research/handoffs = `onDelete: "cascade"`、place_candidates.matched_store_id = `"set null"`。**stores を参照する FK はこの 4+1 本で全部**(トリガー等も無し) |
| FK インデックス | `lib/db/schema.ts` | **子テーブル FK 列にインデックス無し**(deals.store_id / research.store_id / handoffs.store_id / handoffs.deal_id)。件数 COUNT・cascade 削除とも seq scan(現データ規模では許容) |
| 確認ダイアログ(一覧行) | `app/(main)/stores/_components/store-row-actions.tsx:41-72` | 固定文「関連する商談・調査・ハンドオフ・**Deep Research** も同時に削除されます」← 廃止機能の文言が残存 |
| 確認ダイアログ(詳細) | `app/(main)/stores/[id]/_components/delete-store-button.tsx:33-67` | `dealCount` prop(RSC 供給)のみ部分的にデータ駆動。調査/引き継ぎ/場所候補は非表示 |
| 確認ダイアログ(一括) | `app/(main)/stores/_components/stores-table-view.tsx:244-272` | 選択件数のみデータ駆動。紐づけは固定文 |
| エラー整形 | `lib/db/postgres-error.ts:116-139` | 23503 文言に「スキーマの ON DELETE 設定を確認してください」— 開発者向け文が UI に露出(要改善小) |
| 読み取り系 Server Action 前例 | `lib/actions/area-search-actions.ts:142,257,271` | client からの on-demand fetch パターンの先行実装 |
| CI: migration 適用 | `.github/workflows/migrate.yml` | main push × `drizzle/**` 変更で `pnpm db:migrate`。0016〜0020 実績あり |
| CI: 整合性チェック | `scripts/check-drizzle-migrations.sh` | ファイル↔journal の形式整合のみ。**適用済み実態のドリフトは検出不能**(今回の見逃し要因) |
| 本番 DB 検分の接続様式 | `.github/workflows/supabase-keepalive.yml` | Node `postgres` + `prepare:false, max:1`。psql は DATABASE_URL の特殊文字で不可 |

## 3. 本番 DB 実測結果(2026-07-04, SELECT のみ)

### FK 制約(stores / deals を参照するもの全件)

| 子テーブル | 制約名 | 本番の実態 | schema.ts の宣言 | ドリフト |
|---|---|---|---|---|
| deals | deals_store_id_stores_id_fk | **NO ACTION** | cascade | **あり** |
| research | research_store_id_stores_id_fk | **NO ACTION** | cascade | **あり** |
| handoffs | handoffs_store_id_stores_id_fk | **NO ACTION** | cascade | **あり** |
| handoffs | handoffs_deal_id_deals_id_fk | **NO ACTION** | cascade | **あり** |
| place_candidates | place_candidates_matched_store_id_stores_id_fk | SET NULL | set null | なし(0020 正常適用) |

- 重複制約・旧名制約・非内部トリガーは無し。`research_jobs` / `research_reports` は存在しない(0017 適用済み)。

### migration 台帳(drizzle.__drizzle_migrations)

- 適用 20 行 vs journal 21 エントリ。`created_at` を journal `when` と突合した結果、**0013 / 0014 / 0015 が未適用**(0009 / 0010 相当値が二重適用されており行数の辻褄が合って見える。台帳には過去の手動介入痕跡あり)。
- 現在の水位線 = 0020 の `when`(2026-06-13T21:30:55.948Z)。**これより古い folderMillis は今後も適用されない** → 0015 の自然回復は無い。逆に、**新規 0021(fresh timestamp)は既存 CI で確実に適用される**。
- 再現用クエリ(読み取り専用): `select conrelid::regclass, conname, pg_get_constraintdef(oid) from pg_constraint where confrelid='public.stores'::regclass and contype='f';` / `select id, created_at from drizzle.__drizzle_migrations order by id;`

## 4. Requirement-to-Asset Map

| 要件 | 資産 | ギャップ判定 |
|---|---|---|
| Req 1.1 / 1.2 削除成立・非ブロック | コード側は充足(actions/repo/schema) | **Missing(環境)**: 本番 FK が NO ACTION。是正 migration が必要 |
| Req 1.3 孤児ゼロ | FK cascade / set null(DB 層) | 制約是正後に充足。**Constraint**: DB 制約に依存する設計を維持すること |
| Req 1.4 原子性 | 単発 DML + 暗黙 transaction (`store-repository.ts:223-240`) | 充足。**Constraint**: 明示 transaction wrap は Pooler 非互換で禁止(PR #144 教訓)。単発文構造を崩さない |
| Req 1.5 全経路同一ポリシー | 3 経路とも同一 repos 経由 | 充足 |
| Req 2.1-2.5 確認ダイアログ | 3 経路とも Modal 実装済み(店舗名 / 一括件数表示あり) | 充足(文言のみ Req 3 で刷新) |
| Req 3.1-3.5 データ駆動可視化 | 無し(固定文。詳細のみ dealCount) | **Missing**: 影響件数取得(repository メソッド + 読み取り Server Action)と表示 UI が新規に必要 |
| Req 4.1 成功フィードバック | redirect / toast.success | 充足 |
| Req 4.2 内部情報非露出 | postgres-error 二系統設計(PR #144) | **Partial**: 23503 文言中「スキーマの ON DELETE 設定…」が開発者向け。文言更新推奨 |
| Req 4.3 一括部分結果 | deletedCount/requestedCount + toast.warn | 充足 |
| Req 4.4 診断ログ分離 | 構造化 console.error + dumpUnrecognizedErrorShape | 充足 |
| Req 5.1-5.4 全環境保証 | 無し | **Missing**: 0021 是正 migration + 適用後の実地検証。**Unknown→解消済み**: ドリフトの実態は本実測で確定 |

## 5. 実装アプローチ選択肢

### ワークストリーム 1: 本番 FK 制約の是正(Req 1 / 5)

- **Option 1a(推奨): 手書き migration `0021_reassert_store_cascade_fks.sql` + journal 追記**
  - 内容: 4 制約を `ALTER TABLE ... DROP CONSTRAINT IF EXISTS ...; ALTER TABLE ... ADD CONSTRAINT ... ON DELETE CASCADE;` で再宣言(冪等。既に cascade の DB に流しても同結果)。journal `when` は生成時刻(> 現水位線)。
  - ✅ 既存 CI(`migrate.yml`)がそのまま適用・記録。監査可能・再現可能。`check-drizzle-migrations.sh` の 4 チェックを通過。手書き migration の前例あり(0014 等)
  - ❌ `drizzle-kit generate` は差分ゼロ(schema.ts は既に cascade 宣言)のため生成不可 → SQL/journal とも手書き(過去メモリの通り生成 SQL 混入事故に注意する必要はそもそも無い)
- **Option 1b: Supabase ダッシュボードで手動 SQL**
  - ✅ 最速 ❌ 非監査・台帳に残らず「schema.ts と本番が一致している根拠」が again 口伝になる。不採用推奨
- **Option 1c(1a への追加): ドリフト検証の恒久化**
  - 適用後の一回性検証(pg_constraint の confdeltype 確認)に加え、`check-drizzle-migrations.sh` へ「journal `when` の単調増加チェック」を足すと水位線スキップの再発を静的に検出できる(DB 接続不要)。live 検証 CI は DATABASE_URL 依存のため任意

### ワークストリーム 2: 確認ダイアログのデータ駆動化(Req 3 / 2 / 4)

- **Option A: 既存 3 ダイアログを個別拡張**
  - ✅ 変更ファイル最小 ❌ 文言・取得ロジックが 3 箇所に重複増殖(現状の固定文重複がそのまま温存される)
- **Option B(推奨): 共有 confirm ダイアログ + 読み取り Server Action**
  - 新規: `StoreRepository.getDeleteImpact(ids: string[])`(deals/research/handoffs/place_candidates の 4 COUNT を 1 往復で返す)+ `getStoreDeleteImpactAction(ids)`(読み取り系 action。前例 `area-search-actions.ts`)+ 共有ダイアログ内容コンポーネント(開いた時に fetch、カテゴリ別件数と「削除/紐付け解除」種別を表示、0 件カテゴリ非表示、全 0 件時は「紐づけデータなし」文言)。
  - 3 経路(一覧行 / 詳細 / 一括)が同一コンポーネントを使い、単体と一括で同じ表示規約。詳細ページの `dealCount` prop 経路は共有化に伴い整理。
  - ✅ Req 3 の意味論が単一実装に集約、廃止済み「Deep Research」文言も一掃 ❌ 3 surface の組み替えでやや大きめの diff
- **Option C: ハイブリッド段階導入**
  - Phase 1 = WS1(0021)を先行(本番ブロックの即時解消 = ユーザー可視の最重要効果)、Phase 2 = Option B。PR も分割

### 推奨: **C(1a → B の 2 段階)** + 1c の静的チェック追加

## 6. Effort & Risk

| 単位 | Effort | Risk | 根拠 |
|---|---|---|---|
| WS1: 0021 是正 + 検証 | **S** | **Medium** | SQL は 8 文の定型。ただし本番 DDL + journal 手書き(when > 水位線の厳守)という鋭利な縁。冪等 SQL・既存 CI・小規模テーブルで緩和 |
| WS2: データ駆動ダイアログ | **S〜M** | **Low** | 既存パターン(読み取り action / Modal / toast)の組み合わせ。新規依存ゼロ |
| 合計 | **M**(3〜5 日) | **Medium** | 実測によりドリフトの Unknown は解消済み。残リスクは適用手順のみ |

## 7. 設計フェーズへの推奨・Research Needed

1. **0021 の SQL 最終形**: DROP IF EXISTS→ADD の対で 4 制約(handoffs.deal_id 含む)。FK 子列インデックス(deals.store_id / research.store_id / handoffs.store_id / handoffs.deal_id)を同梱するか決める(supabase-postgres-best-practices: FK 列 index は cascade 削除・COUNT の seq scan を防ぐ。現規模では任意、同梱コスト小)
2. **journal `when` の規約**: 現水位線(1781386255948)超の生成時刻を用いる。単調増加チェックの `check-drizzle-migrations.sh` への追加
3. **ダイアログ fetch UX**: open 時 fetch の loading / 失敗時挙動(失敗時に承認を許すか、フォールバック文言か)。表示件数と実削除件数の TOCTOU(開いてから確定までの増減)は許容と明記するか
4. **handoff 越境エッジ**: `handoffs.deal_id` が他店舗の deal を指すデータは想定外だが、件数集計は `store_id` 基準で数える旨を設計で確定
5. **23503 文言更新**: 「スキーマの ON DELETE 設定を確認してください」→ 利用者向け表現へ(Req 4.2 の徹底)
6. **適用後検証手順**: (a) pg_constraint で 4 制約の `ON DELETE CASCADE` を確認(本分析の再現クエリ)、(b) 本番でテスト店舗+紐づけデータを作成→削除→連鎖確認(削除対象はテストデータのみ)

---

# Design Discovery & Decisions (kiro-spec-design)

- 実施日: 2026-07-04
- **Discovery Scope**: Extension(light discovery。gap 分析で本番実測まで完了済みのため、設計に必要なインターフェース検分のみ追加実施)

## Research Log

### drizzle-kit custom migration の可否
- **Context**: 0021 は schema.ts に差分が無い(cascade 宣言済み)ため `db:generate` では生成されない。journal 手書き編集は水位線・整合の事故リスク。
- **Sources**: package.json(drizzle-kit ^0.31.10)、drizzle-kit `generate --custom`(空 SQL + journal エントリを公式生成)
- **Findings**: `pnpm db:generate --custom --name=reassert_store_cascade_fks` で journal `when` = 生成時刻が自動付与される。現水位線(0020 = 1781386255948)を確実に越える。
- **Implications**: `_journal.json` の手書き編集を全廃できる。D1 に採用。

### drizzle-kit migrate の適用単位と DDL 原子性
- **Context**: DROP → ADD を別文にすると文間失敗で「制約なし」の窓が生じる懸念。
- **Findings**: migrate.yml 自身のコメントが「partial 適用リスクは低い (各 SQL = 単一 DDL)」と statement 単位適用を前提にしている。PostgreSQL の ALTER TABLE は複数サブコマンドを 1 文に束ねられる。
- **Implications**: 0021 は「1 制約 = 1 文(DROP IF EXISTS + ADD を同一 ALTER TABLE)」で statement 原子性を確保(design.md §Data Models)。

### UI 統合の前提確認
- **Findings**: `Modal` は controlled(`open`/`onOpenChange`)+ compound(`ModalContent(title,size)`/`ModalFooter`)。focus trap / Escape / `aria-modal` 実装済み(`components/ui/modal.tsx`)。読み取り系 Server Action の client on-demand fetch は `area-search-actions.ts` に確立済み。`[id]` 配下 → `stores/_components` の cross-import 前例あり(`store-edit-form.tsx` 等)。
- **Implications**: 新規 UI プリミティブ不要。共有ダイアログは既存 API の組み合わせで成立。

### dealCount 供給経路
- **Findings**: `[id]/page.tsx:40-41` が `listDealsByStoreCached`('use cache')で deals を取得し件数のみ利用 → tabs → DeleteStoreButton へ 2 段中継。キャッシュ由来の stale 件数になり得る。
- **Implications**: ダイアログ open 時 fetch(非キャッシュ)が上位互換。prop 経路と page の余分な取得を削除(D8)。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| 既存レイヤード拡張(採用) | Repository + Server Action + 共有 Client ダイアログ | 新規依存ゼロ・steering 完全準拠・最小 diff | なし | gap 分析 Option C(1a→B)を具体化 |
| RSC 事前計算(棄却) | 一覧/詳細描画時に全行の件数を先読み | ダイアログ即表示 | 一覧で N+1、キャッシュ невalidate 複雑化、stale 表示 | Req 3.5(実データ)に不利 |
| 各 surface 個別拡張(棄却) | 3 ダイアログをそれぞれ改修 | 変更ファイル最小 | 文言・取得ロジック 3 重複の温存(現行の乖離の再生産) | gap 分析 Option A |

## Design Decisions

### Decision: D1 — 0021 は drizzle-kit `generate --custom` で生成する
- **Alternatives**: (a) journal 手書き追記、(b) Supabase ダッシュボード手動 SQL
- **Selected**: `--custom` 公式機構。**Rationale**: 水位線超えの `when` をツールが保証・監査可能・check スクリプト通過。**Trade-offs**: なし。**Follow-up**: 生成後に SQL 本文を記述し `pnpm db:check` を通す。

### Decision: D2 — 影響件数は `getDeleteImpact(ids)` + 非キャッシュ読み取り action
- **Alternatives**: RSC precompute / 'use cache' クエリ + タグ invalidate
- **Selected**: open 時 on-demand fetch(単一 SELECT・スカラーサブクエリ ×4)。**Rationale**: Req 3.5 の freshness、一覧 N+1 回避、invalidate 網の複雑化回避。**Trade-offs**: open 毎に 1 往復(許容)。

### Decision: D3 — 確認ダイアログは共有コンポーネント 1 実装(削除ロジック非所有)
- **Selected**: `StoreDeleteConfirmDialog` が fetch+表示+承認 UI、削除実行と後続遷移は呼び出し側の `onConfirm`。**Rationale**: 3 重複の文言乖離(廃止済み Deep Research 文言)を根絶しつつ、redirect/refresh の経路差を呼び出し元に閉じる。

### Decision: D4 — FK 子列インデックスは独立した生成 migration 0022
- **Rationale**: cascade 削除・COUNT の seq scan 回避(supabase-postgres-best-practices)。0021 と分離し単独で取り消せる粒度。**Follow-up**: 生成 SQL が CREATE INDEX のみか必ずレビュー(過去の generate 混入事例)。

### Decision: D5 — 水位線再発防止は静的チェック(Check 5: journal `when` 単調増加)のみ
- **Alternatives**: DATABASE_URL 依存の常設ドリフト検知 CI
- **Selected**: 静的チェック + one-shot 検証スクリプト。**Rationale**: 境界を「この修正の保証」に限定(Simplification)。常設 CI は運用面の新規負担で Out of Boundary。

### Decision: D6 — 影響 fetch の失敗・遅延は承認をブロックしない
- **Rationale**: 読み取りクエリの可用性が削除可否(Req 1.2)を左右してはならない。失敗時は件数を偽装せず汎用警告で degrade。

### Decision: D7 — 23503 UI 文言から開発者向け文を除去
- **Selected**: 「関連データに紐づいているため削除できませんでした。解消しない場合は管理者に連絡してください。」formatter は全エンティティ共通のため店舗固有にしない。

### Decision: D8 — dealCount prop 経路の廃止
- **Selected**: `[id]/page.tsx` の `listDealsByStoreCached` 件数算出・tabs 中継・button prop を削除し、ダイアログ fetch に一本化。

## Risks & Mitigations
- 0021 適用失敗(CI red)— 各文が冪等・原子的、watermark 未更新のため修正後の再 merge で再適用される
- 0022 生成 SQL への無関係差分混入 — レビュー必須の Validation Hook を design.md / tasks に明記
- E2E が本番 DB 直結 — 使い捨てテスト店舗のみで実施、既存データ不可侵(design.md §Testing 冒頭に明記)
- `ADD CONSTRAINT` の既存子行検証 — NO ACTION が整合を常時強制してきたため孤児は存在し得ず、検証失敗リスクは実質ゼロ

## References
- `node_modules/drizzle-kit`(^0.31.10)— `generate --custom`
- `.claude/skills/supabase-postgres-best-practices/references/schema-foreign-key-indexes.md` — FK 列インデックス
- `.github/workflows/migrate.yml` — 適用機構と安全前提(statement 単位)
- 本ファイル前半(gap 分析)§3 — 本番実測の一次データ
