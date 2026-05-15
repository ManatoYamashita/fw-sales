# Gap Analysis: auth-and-notifications

参照仕様: `.kiro/specs/auth-and-notifications/requirements.md`
分析対象コミット: `1bb299c` (branch `fix/use-cache-timeout-dynamic`)
分析日: 2026-05-10

---

## 0. Executive Summary

- 本仕様は **3 大柱(認証 / メール基盤 / 担当者カラム移行)** + **2 つのアプリ統合タスク(#14 連携 / #15 連携)** を 1 つの基盤整備として束ねる。
- 既存コードベースは **Drizzle + postgres による DB 層が稼働中** (4 マイグレーション、`USE_MOCK_DB` で Mock 経路へ動的切替) で、Repository パターン / Cache タグ / Server Actions 規約が完備されている。**スキーマ追加と Repos への参加は摩擦が少ない**。
- 一方で **認証 / メール / Cron / プロフィール** は 1 行も存在しない。`lib/domain/staff.ts:10-13` の `CURRENT_USER = { name: "佐藤" }` 定数が「将来の認証導入」を想定したマーカーになっている。
- 担当者(`assigned_*`)は **types / schema / mock seed / form / Server Action / UI 表示** の 6 レイヤーすべてで text として横展開されており、移行コストの大半はこの「横断置換」が占める。
- 推奨アプローチは **Option C: Hybrid**。認証 / メール / Cron は新規モジュール、プロフィール / 通知は既存 Repos へ追加、担当者移行は **2 段階マイグレーション + バックフィルスクリプト** で漸進実施する。
- 全体規模: **L(1〜2 週間)**、リスク: **Medium**(`@supabase/ssr` v0.5+ × Next.js 16 の組合せが Edge case ありうる)。

---

## 1. Current State Investigation

### 1.1 アーキテクチャ俯瞰

| 領域 | 既存実装の有無 | 主要パス |
|---|---|---|
| Next.js App Router (RSC + Server Actions) | あり | `app/(main)/**`, `lib/actions/**`, `lib/queries/**` |
| Drizzle + postgres による DB 層 | **あり(稼働中)** | `lib/db/{client,schema,index}.ts`, `drizzle/*.sql` (0000〜0003) |
| Mock / DB 切替 (`USE_MOCK_DB`) | あり | `lib/repositories/index.ts:81-139` |
| Cache Components 戦略 (`'use cache'` + `cacheTag`) | あり | `lib/queries/**`, `lib/cache.ts` |
| Repository パターン(interface = `lib/repositories/`、impl = `lib/db/` or `lib/mock/`) | あり | `lib/repositories/index.ts:42-79` |
| Vitest によるテスト | **あり**(steering の記述と矛盾) | `vitest.config.ts`, `lib/{db,actions,ai}/__tests__/**` |
| 認証 / セッション / middleware | **なし** | (新規) |
| ユーザー / プロフィール概念 | text 配列のみ(`PLANNERS` / `SALES` / `OPS_MEMBERS` / `CURRENT_USER`) | `lib/domain/staff.ts` |
| メール送信 | **なし** | (新規) |
| Cron / 定期ジョブ | **なし** | (新規) |
| Notifications テーブル / ベル UI | **なし**(#14 待ち) | placeholder のみ `components/layout/topbar.tsx:48-54` |

### 1.2 既存マイグレーション(`drizzle/`)

```
0000_living_darwin.sql              -- 初期スキーマ (stores, deals)
0001_add_operator_and_ai_analysis.sql  -- stores に operator_type / operator_name / ai_analysis_result
0002_simple_sage.sql                -- research, handoffs テーブル
0003_add_store_geo_hours.sql        -- stores に lat / lng / business_hours
```

本仕様で追加する次番号は **`0004_*`** から開始する。

### 1.3 既存依存パッケージ(`package.json`)

| カテゴリ | 既存 | 必要追加 |
|---|---|---|
| DB | `drizzle-orm`, `postgres`, `drizzle-kit` | (なし。プロフィール / 通知は同一スタック内) |
| Auth | (なし) | `@supabase/supabase-js`, `@supabase/ssr` |
| Email | (なし) | `resend` (推奨) または代替 |
| HTML テンプレート | (なし) | `react-email` または `@react-email/components` (任意) |
| Validation | `zod` | (再利用) |
| AI | `@google/genai` | (関係なし) |

依存追加は計 2〜4 パッケージ。tech.md の「外部ライブラリは原則禁止」規約に対しては **必要性を明示** で乗り越える。

---

## 2. Requirement-to-Asset Map

各要件 (`requirements.md` の Requirement N) に対し、既存資産 / 不足資産 / 制約をマップする。タグ凡例: 🟢 Reusable / 🟡 Extend / 🔴 Missing / ⚪ Constraint。

### Requirement 1: Google OAuth 認証アクセス制御

| 必要技術要素 | 既存 | 状態 | 補足 |
|---|---|---|---|
| `middleware.ts` (Next.js) | なし | 🔴 Missing | Next.js 16 + `@supabase/ssr` ヘルパで新規実装 |
| `app/login/page.tsx` | なし | 🔴 Missing | サインイン UI(Google ボタンのみ) |
| `app/auth/callback/route.ts` | なし | 🔴 Missing | OAuth コールバック |
| Supabase クライアント(server / client) | なし | 🔴 Missing | `lib/supabase/{server,client,middleware}.ts` |
| ヘッダー領域(ユーザーメニュー差込先) | あり(`components/layout/topbar.tsx:46-54` に Bell placeholder) | 🟡 Extend | 既存 Bell の隣に UserMenu を追加 |
| 認証エラー UI | なし | 🔴 Missing | `/login` 上で表示 |
| `(main)` 配下の保護対象ルート(dashboard, stores, deals, research, pipeline, handoffs, kpi, settings, actions) | あり(全 9 セクション) | 🟢 Reusable | middleware で一括保護 |
| ⚪ Next.js 16 + cookies() async 互換 | 既存コードで対応済 | ⚪ Constraint | `@supabase/ssr` v0.5+ 必須 |

### Requirement 2: ユーザープロフィール自動生成

| 必要技術要素 | 既存 | 状態 | 補足 |
|---|---|---|---|
| `profiles` テーブル定義(Drizzle schema) | なし | 🔴 Missing | `lib/db/schema.ts` に追加 |
| `auth.users` への INSERT trigger | なし | 🔴 Missing | Postgres 関数 + trigger 用マイグレーション |
| `profiles` リポジトリ interface | なし | 🔴 Missing | `lib/repositories/profile-repository.ts` |
| DB 実装 | なし | 🔴 Missing | `lib/db/profile-repository.ts` |
| Mock 実装 | なし | 🔴 Missing | `lib/mock/profile.ts` |
| Repos 集約への組込 | あり(`Repos` interface) | 🟡 Extend | `lib/repositories/index.ts:58-79` の `TxRepos` / `Repos` を拡張 |
| Cache タグ(`profiles` / `profile:`) | なし | 🔴 Missing | `lib/cache.ts` の `CACHE_TAGS` に追加 |
| Profile 型 | なし | 🔴 Missing | `types/profile.ts` 新規 |
| ⚪ Repos の top-level await + 動的 import 規約 | あり | ⚪ Constraint | `lib/repositories/index.ts:81-139` のパターンに準拠する必要あり |

### Requirement 3: 担当者表現のユーザー参照への完全置換(横断置換)

| レイヤ | 既存パス | 変更要否 |
|---|---|---|
| 型 | `types/store.ts` (`assigned_planner: string` / `assigned_sales: string`) | 🟡 Extend(`string` のまま FK 用 uuid に意味変更 + コメント) |
| 型 | `types/deal.ts` (`assigned_sales: string`) | 🟡 Extend(同上) |
| Drizzle スキーマ | `lib/db/schema.ts` (`stores.assigned_planner` / `stores.assigned_sales` / `deals.assigned_sales`) | 🟡 Extend(Phase 1: `assigned_*_user_id uuid` 追加 / Phase 2: 旧 text DROP) |
| Mock seed | `lib/mock/seed.ts:26-27, 57-58, 88-89` | 🟡 Extend(seed プロフィール定義 + uuid 参照に置換) |
| Mock store/deal repo | `lib/mock/{store,deal}.ts` | 🟡 Extend(フィルタ・ソートで参照する箇所) |
| DB store/deal repo | `lib/db/{store,deal}-repository.ts` | 🟡 Extend |
| Server Action | `lib/actions/{store,deal}-actions.ts` (`readString(formData, "assigned_planner"/"assigned_sales")`) | 🟡 Extend(uuid 検証追加 + フォームキー名は維持か `_user_id` 化) |
| 入力フォーム | `app/(main)/stores/new/_components/store-new-form.tsx:30,58-59,81-82`, `app/(main)/deals/new/_components/deal-new-form.tsx:13,26` | 🟡 Extend(text input → user 選択 Combobox) |
| 表示 | `app/(main)/pipeline/_components/kanban-board.tsx`, `app/(main)/stores/_components/stores-table.tsx` | 🟡 Extend(profile 名を join して表示) |
| 既存 `STAFF` 系定数 | `lib/domain/staff.ts:1-13` | 🟡 Extend or 🔴 Deprecate(`CURRENT_USER` は廃止、`PLANNERS` / `SALES` はプロフィール由来に) |
| バックフィルスクリプト | (なし。`scripts/seed.ts` が参考実装) | 🔴 Missing — `scripts/backfill-assignees.ts` 新規 |
| ⚪ DB 切替の単一窓口 | あり | ⚪ Constraint(DB 切替で Mock / DB 両方が同等の挙動を満たす義務) |
| ⚪ 移行マイグレーションの 2 段階性 | (新規) | ⚪ Constraint(Phase 1 と Phase 2 の間でアプリは新カラムのみを参照する状態に到達する必要) |

### Requirement 4: メール送信基盤

| 必要技術要素 | 既存 | 状態 | 補足 |
|---|---|---|---|
| `lib/email/client.ts` | なし | 🔴 Missing | Resend SDK ラッパ |
| メールテンプレート(完了 / 失敗 / リマインダー) | なし | 🔴 Missing | `lib/email/templates/` 新規 |
| no-op フォールバック | (なし) | 🔴 Missing | `RESEND_API_KEY` 未設定時に warn ログ + 送信スキップ |
| ⚪ プレフィックス `[fw-sales]` | (運用規約) | ⚪ Constraint | 全送信メールで件名先頭に固定 |

### Requirement 5: 調査ジョブ完了 / 失敗のメール通知

| 必要技術要素 | 既存 | 状態 | 補足 |
|---|---|---|---|
| `store_research_jobs` テーブル | **なし(#14 で新設予定)** | 🔴 Missing(adjacent) | `triggered_by` を text → uuid 化する責務は本仕様 |
| ジョブステータス遷移フック | (新規) | 🔴 Missing | #14 のジョブワーカー (`lib/jobs/research-worker.ts` 想定) から `lib/email/client.ts` を呼ぶ |
| 完了 / 失敗テンプレート | なし | 🔴 Missing | `lib/email/templates/research-job-{completed,failed}.tsx` |
| ⚪ #14 との並行着手 | — | ⚪ Constraint | 本仕様で進められる範囲: メール基盤・プロフィール・テンプレート / #14 待ち: ジョブテーブル・ワーカー実装連携 |

### Requirement 6: 商談予定日リマインダー定時メール

| 必要技術要素 | 既存 | 状態 | 補足 |
|---|---|---|---|
| Cron 実行基盤 | なし | 🔴 Missing | Vercel Cron(`vercel.json`)or pg_cron |
| Cron Route Handler | なし | 🔴 Missing | `app/api/cron/deal-reminders/route.ts` |
| Cron 認可(CRON_SECRET / Bearer) | なし | 🔴 Missing | Vercel Cron の `Authorization: Bearer ${CRON_SECRET}` を route で検証 |
| 商談クエリ(date = 翌日 / 当日 + assigned_sales_user_id NOT NULL) | あり(`lib/queries/deals.ts` 推測) | 🟡 Extend | 新クエリ追加 |
| ユーザーごと集約 | (なし) | 🔴 Missing | route handler 内で aggregate |
| リマインダーテンプレート | なし | 🔴 Missing | `lib/email/templates/deal-reminder.tsx` |
| ⚪ JST 基準時刻 | — | ⚪ Constraint | Vercel Cron は UTC 指定 → `0 22 * * *` (前日朝 7:00 JST) など |

### Requirement 7: アプリ内通知の通知先絞り込み

| 必要技術要素 | 既存 | 状態 | 補足 |
|---|---|---|---|
| `notifications` テーブル | **なし(#14 で新設予定)** | 🔴 Missing(adjacent) | `user_id` カラムを本仕様で追加 |
| 通知ベル UI(unread count + 一覧) | placeholder のみ(`components/layout/topbar.tsx:48-54`) | 🟡 Extend(#14) | 本仕様は user_id でフィルタする責務のみ |
| 通知作成時の user_id 記録 | (新規) | 🔴 Missing | 通知発生イベントごとに対象ユーザーを特定する判定ロジック |

### Requirement 8: 環境変数とランタイム構成

| 必要技術要素 | 既存 | 状態 | 補足 |
|---|---|---|---|
| `.env.example` | あり(USE_MOCK_DB / DATABASE_URL 等) | 🟡 Extend | 7 つの新環境変数追記(`NEXT_PUBLIC_SUPABASE_URL` 等) |
| 起動時環境変数バリデーション | (なし、ランタイム参照のみ) | 🔴 Missing | 認証関連が未設定なら warn + サインイン経路は失敗扱い |
| メール送信キーの no-op 動作 | (なし) | 🔴 Missing | `RESEND_API_KEY` 未設定時に no-op + warn 1 回ログ |

---

## 3. Implementation Approach Options

### Option A: 既存パターン最大活用 (Extend Everything)

**方針**: 既存 `lib/repositories/index.ts` の Mock/DB 動的切替・`CACHE_TAGS` / Server Actions / Drizzle スキーマをそのまま拡張し、新規ディレクトリ最小構成。

- `lib/repositories/profile-repository.ts` + `lib/db/profile-repository.ts` + `lib/mock/profile.ts` を追加し `Repos` interface 拡張のみで通過
- メール送信ロジックは `lib/notifications/email.ts` のような最小モジュールに集約
- Cron は `app/api/cron/*` のみ、認証 helpers は `lib/auth.ts` 単一ファイル

**Pros**:
- 学習コスト最小、コードレビュー単位が小さい
- structure.md の「役割ごとのレイヤード構成」と完全一致

**Cons**:
- `@supabase/ssr` のセッション管理は server / client / middleware の 3 ヘルパが必要で **単一ファイル化は無理**
- メール周りもテンプレート + クライアント + 失敗時 ログ で 3 ファイル以上不可避

**判定**: Option B または C が現実的。Option A 単独では `@supabase/ssr` 規約に反する。

### Option B: 専用モジュール群を新設 (Greenfield Modules)

**方針**: 認証 / メール / 通知を `lib/auth/`、`lib/email/`、`lib/notifications/` として独立ディレクトリ化。プロフィールも `lib/profiles/` として既存 `lib/repositories` から分離。

**Pros**:
- 各機能の責務境界が明確
- 認証関連の追加機能(招待制、ロール制御)を将来追加しやすい

**Cons**:
- structure.md の依存方向(`lib/queries`/`lib/actions` → `lib/repositories` → `lib/mock`/`lib/db`)を **profile だけ別経路**にすると整合性が崩れる
- `Repos` interface 経由で参照されない repo が出ると、トランザクション境界が曖昧化

**判定**: プロフィール / 通知は既存 Repos に乗せるべき(Option C へ)。

### Option C: Hybrid — 認証/メール/Cron は新設、データ層は既存 Repos へ統合(推奨)

**方針**:

| カテゴリ | 配置 | 既存規約への適合 |
|---|---|---|
| Supabase クライアント | `lib/supabase/{server,client,middleware}.ts` 新規 | `@supabase/ssr` 公式パターンに従う |
| 認証 middleware / login / callback | `middleware.ts` (root) / `app/login/page.tsx` / `app/auth/callback/route.ts` | Next.js 16 App Router の標準配置 |
| **profiles データ層** | `lib/repositories/profile-repository.ts` + `lib/db/profile-repository.ts` + `lib/mock/profile.ts` + `Repos` interface 拡張 | structure.md に完全準拠 |
| **notifications データ層** (#14 連携) | 同パターン(`lib/repositories/notification-repository.ts` + impls) | 同上 |
| Cache タグ追加 | `lib/cache.ts` 拡張 | structure.md 規約 |
| メール送信 | `lib/email/{client,templates}/` 新規 | Server Actions と同じく `import "server-only"` |
| Cron route | `app/api/cron/deal-reminders/route.ts` + `vercel.json` | App Router 標準 |
| 担当者カラム移行 | 2 段階マイグレーション + `scripts/backfill-assignees.ts` (`scripts/seed.ts` 流儀に準拠) | 既存 Drizzle / Mock 規約 |
| `lib/domain/staff.ts` の扱い | `CURRENT_USER` 削除、`PLANNERS` / `SALES` はプロフィールクエリ由来に置換(or 完全廃止) | 段階的に置換 |

**Pros**:
- 認証 / メール / Cron は独立性高く、データ層は既存 Repos に乗ることで Mock 経路でも擬似動作可能
- 新規ファイル数 ≈ 25、既存修正ファイル ≈ 20 で見通し良好
- 段階的にマージできる(Phase 1 = 認証 + プロフィール、Phase 2 = 担当者移行、Phase 3 = メール / Cron / #14 連携)

**Cons**:
- 5 つの責務領域が並行進行するため PR 分割設計が必須(Issue の「想定タスク分割 14 件」が指針)

**判定**: **採用推奨**。

---

## 4. Effort & Risk

### 4.1 Phase 別見積

| Phase | 内容 | Effort | Risk |
|---|---|---|---|
| 1. 認証 + プロフィール基盤 | 依存追加、Supabase クライアント、middleware、`/login`、callback、`profiles` テーブル + trigger、`Profile` 型 / 型 / Repos 統合、Topbar UserMenu | **M(3〜5 日)** | Medium |
| 2. 担当者カラム移行 | スキーマ変更 Phase 1、バックフィルスクリプト、フォーム / Action / 表示の置換、Phase 2(旧 text DROP) | **M〜L(4〜7 日)** | Medium-High |
| 3. メール基盤 | `lib/email/` 一式、Resend SDK 統合、no-op フォールバック、テンプレート 3 種(完了 / 失敗 / リマインダー) | **S〜M(2〜3 日)** | Low |
| 4. リマインダー Cron | Cron route、`vercel.json`、JST 時刻設計、商談クエリ追加、CRON_SECRET 検証 | **M(3〜4 日)** | Medium |
| 5. #14 連携 | `store_research_jobs.triggered_by` uuid 化、`notifications.user_id` 追加、ジョブワーカーから email 呼出、通知ベルフィルタ | **M(3〜5 日、#14 完了前提)** | High(#14 のスケジュール依存) |
| 6. テスト + 検証 | Vitest 追加、E2E 手動チェックリスト、移行ロールバック手順書 | **S〜M(2〜3 日)** | Low |

**合計**: **L (1.5〜2 週間程度の集中作業) 〜 XL (#14 待ち発生時)**

### 4.2 リスク詳細

| リスク | 影響度 | 緩和策 |
|---|---|---|
| **R1**: `@supabase/ssr` v0.5+ × Next.js 16 (cookies() async, dynamic API) の Edge case | High | Step 1 を最優先で完了し早期にローカル検証 / 動かないなら v0.4 系 + 自前 cookie wrap 検討 |
| **R2**: 担当者バックフィルで text → profile マッチ漏れ → placeholder 大量発生 | Medium | distinct リスト + マッピングプレビューを実行ログに出し、ユーザー確認後に UPDATE 適用 / dry-run モード必須 |
| **R3**: Phase 1(新カラム)と Phase 2(旧 DROP)の間にデプロイがあると、旧版アプリが新カラムを知らないまま新規挿入し新カラム NULL になる | Medium | アプリ側を「新カラムのみ参照」に切替えてから旧 DROP / Phase 1+2 同一デプロイで通す運用 |
| **R4**: Vercel Cron Hobby プラン制限(1 日 2 回上限)に抵触 | Low | 前日朝 + 当日朝 = 2 回でちょうど枠内 / 必要なら `pg_cron` 検討 |
| **R5**: 自由登録のためメンバー外 Google アカウントが流入 | Medium(運用) | 本仕様 OUT に明記、README に注意 / 招待制は別 Issue |
| **R6**: `CURRENT_USER` 定数の参照箇所削除漏れ → 認証後も "佐藤" 固定で表示される | Medium | grep で全参照を洗い出し、削除を `pnpm typecheck` ガードで検出 |
| **R7**: `notifications` / `store_research_jobs` テーブルの責務分担が #14 と本仕様で曖昧化 | Medium-High | #14 spec の Boundary Commitments を本仕様 design 段階で参照し、`user_id` / `triggered_by` 追加責務だけを本仕様の Boundary Commitment に含める |
| **R8**: Mock 経路でも認証 / メールが動作することを期待される | Low | Mock 経路は認証スキップ + email no-op で開発者体験を保つ(Server Actions 規約と整合) |

---

## 5. Files Touch Inventory

### 5.1 新規作成(28 件想定)

```
middleware.ts
app/login/page.tsx
app/login/_components/google-signin-button.tsx
app/auth/callback/route.ts
app/api/cron/deal-reminders/route.ts
vercel.json
lib/supabase/server.ts
lib/supabase/client.ts
lib/supabase/middleware.ts
lib/repositories/profile-repository.ts
lib/repositories/notification-repository.ts        # #14 と協調
lib/db/profile-repository.ts
lib/db/notification-repository.ts                  # #14 と協調
lib/mock/profile.ts
lib/mock/notification.ts                           # #14 と協調
lib/email/client.ts
lib/email/index.ts
lib/email/templates/research-job-completed.tsx
lib/email/templates/research-job-failed.tsx
lib/email/templates/deal-reminder.tsx
lib/queries/profiles.ts
lib/queries/deals-due-soon.ts                      # リマインダー用
lib/actions/profile-actions.ts                     # signOut / updateProfile 等
components/layout/user-menu.tsx
types/profile.ts
types/notification.ts                              # #14 と協調
scripts/backfill-assignees.ts
drizzle/0004_add_profiles_and_user_id_columns.sql  # Phase 1
drizzle/0005_drop_legacy_assignee_text_columns.sql # Phase 2
drizzle/migrations/handle_new_user.sql             # auth.users trigger
```

### 5.2 既存修正(20 件想定)

```
package.json                                        # @supabase/ssr / supabase-js / resend 追加
.env.example                                        # 7 環境変数追加
app/layout.tsx                                      # SessionProvider(必要なら)
app/(main)/layout.tsx                               # 認証コンテキスト前提に
components/layout/topbar.tsx                        # UserMenu 配置
components/layout/sidebar.tsx                       # ユーザー表示(任意)
lib/db/schema.ts                                    # profiles / 担当者 user_id カラム / notifications.user_id / store_research_jobs.triggered_by uuid 化
lib/db/index.ts                                     # makeProfileRepo / makeNotificationRepo 追加
lib/repositories/index.ts                           # TxRepos / Repos 拡張
lib/cache.ts                                        # profiles / profile:() / notifications / notification:() タグ
lib/domain/staff.ts                                 # CURRENT_USER 削除、PLANNERS/SALES 廃止 or プロフィール由来に
lib/mock/seed.ts                                    # seed プロフィール + 担当者 uuid 参照
lib/mock/{store,deal,research,handoff}.ts           # 担当者参照型変更に追従
lib/db/{store,deal}-repository.ts                   # 担当者カラム名変更
lib/actions/{store,deal}-actions.ts                 # readString → ユーザー参照取得 / バリデーション
types/{store,deal}.ts                               # assigned_*_user_id 型反映
app/(main)/stores/new/_components/store-new-form.tsx  # 担当者選択 UI
app/(main)/deals/new/_components/deal-new-form.tsx    # 同上
app/(main)/{stores,deals,pipeline,handoffs}/**/_components/  # 表示が text → ユーザー名(profile join)
app/(main)/settings/page.tsx                        # 自分のプロフィール表示(任意)
README.md                                           # 自由登録のリスク / 環境変数の説明
```

### 5.3 そのまま再利用(変更不要)

- `lib/db/client.ts`(postgres + drizzle singleton)
- `lib/repositories/index.ts:81-139` の Mock/DB 切替パターン(構造のみ — interface は拡張)
- `lib/actions/_helpers.ts` の `readString` / `readNumber` / `success` / `failure` ヘルパ
- `vitest.config.ts`(server-only alias 設定)
- `drizzle.config.ts`(`./lib/db/schema.ts` 自動スキャン)
- `app/(main)/layout.tsx` のシェル構造
- `components/ui/**` のプリミティブ群

---

## 6. Research Needed (Design 段階に持ち越し)

| 項目 | 解決手段 |
|---|---|
| **R-1** `@supabase/ssr` v0.5+ × Next.js 16.2.4 + React 19.2.4 + cookies() async の最新パターン | `node_modules/next/dist/docs/` の cookies / middleware ガイド + `@supabase/ssr` README で確認 |
| **R-2** Cron 認可方式: Vercel Cron 標準の `Authorization: Bearer ${CRON_SECRET}` か、Route Handler 内で自前検証か | Vercel Cron 公式ドキュメント、Next.js の Vercel 連携ガイド |
| **R-3** メールテンプレート: React Email vs 自前 HTML テンプレート | テンプレート 3 種の保守容易性 vs 依存追加コストのトレードオフ |
| **R-4** Drizzle で `auth.users` (Supabase 管理) を参照する方法 | `pgSchema('auth').table('users', {...})` パターン or 単純に `text PRIMARY KEY` として持ち FK 制約は raw SQL で記述 |
| **R-5** Mock 経路でのプロフィール / 認証スキップ動作 | `USE_MOCK_DB=true` 時は middleware でセッション検証をバイパス → 固定 mock user で動作させる方針 |
| **R-6** バックフィルスクリプトの dry-run / preview 仕様 | `scripts/seed.ts` 既存パターン参考、`pnpm tsx scripts/backfill-assignees.ts --dry-run` |
| **R-7** placeholder profile のメール衝突回避 | `placeholder-{slug}@local.invalid` 形式 + 事前重複チェック |
| **R-8** `notifications.user_id` 追加と #14 のテーブル新設 PR の前後関係 | #14 spec の最終 PR 順序を確認、本仕様は #14 の `notifications` 追加マイグレーションに **`user_id` を含めて生成する** か、後追いで `ALTER TABLE` するかを決定 |
| **R-9** `lib/domain/staff.ts` の段階的廃止 | grep ヒットしない状態への移行手順、`PLANNERS` / `SALES` を `lib/queries/profiles.ts` に置換 |
| **R-10** ロール `placeholder` の取扱(検索結果での扱い・UI 表示) | UI での「未マージ」マーク表示の要否を design phase で決定 |
| **R-11** Vitest テストでの認証 / Supabase スタブ戦略 | `vi.mock('@/lib/supabase/server')` パターン、固定 user fixture |

---

## 7. Recommendations for Design Phase

### 7.1 採用推奨アプローチ

**Option C: Hybrid** を採用。次の Boundary Commitments を design.md に書き起こす。

1. **認証**: `@supabase/ssr` v0.5+ + Google OAuth、middleware で `(main)` 配下を保護、Mock モードでは固定 mock user(`placeholder-dev@local.invalid` 等)で疑似ログイン状態
2. **プロフィール / 通知データ層**: `lib/repositories/index.ts` の `TxRepos` / `Repos` 拡張で統合、Mock / DB 経路の両方を同一 interface で提供
3. **担当者移行**: 2 段階マイグレーション(`0004` 新カラム追加 + `0005` 旧 DROP)、間に `scripts/backfill-assignees.ts` を実行、UI 切替を Phase 1 のデプロイに含める
4. **メール基盤**: Resend 採用、`lib/email/` に集約、`RESEND_API_KEY` 未設定時 no-op、件名先頭 `[fw-sales]`
5. **Cron**: Vercel Cron 採用(Hobby プラン 2 回上限を活用)、`vercel.json` でスケジュール定義、`CRON_SECRET` ヘッダ検証
6. **#14 / #15 連携**: 本仕様は `notifications.user_id` カラム / `store_research_jobs.triggered_by` uuid 化の責務のみを担う(テーブル新設は #14 が担当)。design 段階で #14 spec の Boundary Commitments を参照し境界を再確認

### 7.2 設計フェーズで決めるべき主要トピック

1. プロフィール識別子の型(`uuid` 固定、`text` 互換性ラップなし)
2. middleware のマッチパターン(`(main)` 配下のみ vs 全パス)
3. Mock 経路でのセッションスタブ仕様
4. メールテンプレート方式(React Email vs raw)
5. Cron スケジュール時刻(JST 7:00 / 8:00 = UTC 22:00 / 23:00 前日)
6. バックフィルの dry-run / コンソール出力フォーマット
7. `STAFF` 系定数(`PLANNERS` / `SALES` / `OPS_MEMBERS`)の扱い: 削除 / 移譲 / 共存
8. `auth.users` を Drizzle スキーマに記述するか、外部テーブル参照のみで扱うか

### 7.3 PR 分割推奨(13 件、Issue の想定タスク分割と整合)

```
1. chore(deps): @supabase/{ssr,supabase-js} + resend 追加
2. feat(db): profiles テーブル + auth.users trigger (drizzle 0004 partial)
3. feat(auth): Supabase クライアント (server/client/middleware ヘルパ)
4. feat(auth): /login + /auth/callback + middleware で保護
5. feat(layout): UserMenu コンポーネント + Topbar 配置
6. feat(db): stores/deals に assigned_*_user_id 追加 (drizzle 0004 完成)
7. chore(scripts): backfill-assignees スクリプト + 実行
8. feat(forms): 担当者選択 UI を user 選択に切替
9. feat(db): 旧 assigned_* text DROP (drizzle 0005)
10. feat(email): Resend クライアント + テンプレート基盤
11. feat(notifications): #14 ジョブ完了 / 失敗メール送信
12. feat(cron): 商談リマインダー Vercel Cron + テンプレート
13. feat(notifications): notifications.user_id + ベル UI のフィルタ (#14 完了後)
```

---

## 8. 結論

- 既存コードベースは **Repository / Mock-DB 切替 / Drizzle / Cache タグ** の規約が完備されており、データ層拡張は摩擦が少ない。
- 認証 / メール / Cron は完全新規 = リスクと工数の主因。中でも **`@supabase/ssr` × Next.js 16** の互換性が最大の不確実点。
- 担当者カラム移行は **横断置換 + 2 段階マイグレーション + バックフィル** の組合せでコントロール可能、ただし「Phase 1 と Phase 2 の間のデプロイ設計」を design で明記すべき。
- 推奨アプローチは Option C(Hybrid)、Effort = L、Risk = Medium、推奨 PR 分割 = 13 本。
- 次フェーズ(`/kiro-spec-design auth-and-notifications`)では §6 の Research Needed を解消した上で Boundary Commitments を確定すること。

---

# Design Discovery & Synthesis(2026-05-10 追記)

`/kiro-spec-design auth-and-notifications -y` 実行時に追加した Discovery 結果と Synthesis 決定を記録する。

## Summary

- **Feature**: `auth-and-notifications`
- **Discovery Scope**: Light Discovery(既存基盤拡張 + 新規外部統合の混在、§1〜§7 で扱った gap analysis を拡張)
- **Key Findings**:
  - F-1: Drizzle / Repository パターン / Cache タグ規約は完備されており、profiles / notifications のデータ層追加は既存の `buildRepos()` パターンに **構造的に合流可能**
  - F-2: `@supabase/ssr` v0.5+ の SSR パターンは `cookies()` async 化に追従するため Next.js 16.2.4 + React 19.2.4 と整合する公式実装が確定済(Edge runtime での postgres 直接接続不可は変わらない)
  - F-3: `lib/domain/staff.ts:10-13` の `CURRENT_USER` は当初から「将来の認証導入で置換」を前提としたマーカーであり、廃止に伴う混乱は最小

## Research Log

### 既存 Drizzle スキーマパターンの再確認

- **Context**: `profiles` の id 型(uuid)と既存 stores/deals の id 型(text `<entity>_<id>`)の混在を許容できるか
- **Sources Consulted**: `lib/db/schema.ts:13-48`、`lib/db/schema.ts:60-77`、`drizzle/0002_simple_sage.sql`、`drizzle/0003_add_store_geo_hours.sql`
- **Findings**:
  - 既存テーブルは text PK、列挙型は text + アプリ層型ガード規約
  - profiles は **uuid PK** で auth.users と FK 接続するのが Supabase 標準
  - drizzle-orm の `pgTable` は同スキーマ内で text と uuid PK が混在しても問題ない
  - cross-schema FK (`profiles(id)` → `auth.users(id)`) は drizzle スキーマ宣言では表現困難 → **マイグレーション SQL に raw `ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY` を直書き**
- **Implications**: design.md §Logical Data Model / §Postgres Trigger に上記を反映。0004 マイグレーションは `pgSchema('auth')` を使わず raw SQL で FK / trigger を定義

### `@supabase/ssr` の Server / Client / Middleware 役割分担

- **Context**: 3 ヘルパの責務分担を design に固定する
- **Sources Consulted**: Issue #16 本文(技術選定根拠)、`research.md` §6 R-1
- **Findings**:
  - `createServerClient(url, key, { cookies: { getAll, setAll } })` を Server Component / Server Action で使用、Next.js 16 の async `cookies()` に対応
  - `createBrowserClient(url, key)` を Client Component で使用、`signInWithOAuth` 起動のみが用途
  - Middleware では `createServerClient` の cookies adapter で `request.cookies` / `response.cookies` を渡す helper を別ファイルで提供
- **Implications**: `lib/supabase/{server,client,middleware}.ts` の 3 ファイル分割を design.md §Adapter Layer に反映

### Vercel Cron + JST スケジュール

- **Context**: 前日朝 7:00 JST / 当日朝 8:00 JST の Cron を Vercel Hobby プラン枠で実行する
- **Sources Consulted**: Issue #16 本文「Cron 実行基盤の選定」、Vercel Cron の cron 構文(UTC 固定)
- **Findings**:
  - JST 7:00 = UTC 22:00 → `0 22 * * *`
  - JST 8:00 = UTC 23:00 → `0 23 * * *`
  - Vercel Hobby プランは 1 アカウント 1 日 2 回まで → 2 件 ぴったり収まる
  - Cron 認可は標準で `Authorization: Bearer ${VERCEL_CRON_SECRET}` ヘッダ自動送付されない方式が一般的、自前 `CRON_SECRET` の手動検証が確実
- **Implications**: design.md §Cron Route + §Security に「`Authorization: Bearer ${CRON_SECRET}` 検証、不一致は 401」を確定

### `notifications.user_id` の追加と #14 マイグレーションの順序

- **Context**: テーブル本体は #14 が新設、本仕様は user_id カラム追加責務 → 同一マイグレーションに含めるか分割するか
- **Sources Consulted**: Issue #16 本文「依存関係」、Issue #14(本ブランチ範囲外)
- **Findings**:
  - #14 のマイグレーションが先行する場合: 本仕様は `ALTER TABLE notifications ADD COLUMN user_id` で追加
  - 本仕様 0004 が先行する場合: notifications テーブル自体は #14 の後続マイグレーションで作る
- **Implications**: design.md は **「順序は #14 spec の状態に応じて選択」** と明記、両方のシナリオに対応可能な書き方とする

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|---|---|---|---|---|
| A. Extend Everything | 既存 Repos / Cache タグ / Server Actions のみで完結させる | 学習コスト最小、PR レビュー単位最小 | `@supabase/ssr` は server/client/middleware 3 ヘルパ必須で単一ファイル化不可 | 採用不可 |
| B. Greenfield Modules | 認証 / メール / プロフィールを独立 `lib/auth`, `lib/profiles`, `lib/notifications/` で分離 | 各機能境界が最も明確 | structure.md の「依存方向 / 単一窓口」規約に反する(Repos に乗らない repo が分岐) | 不採用 |
| **C. Hybrid(採用)** | 認証 / メール / Cron は新設、profiles / notifications は既存 Repos へ統合 | structure.md 完全準拠 + 外部 I/O は独立アダプタ化 | 5 領域並行進行のため PR 分割設計が必須 | **採用** |

## Design Decisions

### Decision: D-1 — `@supabase/ssr` v0.5+ × Next.js 16 / React 19 を前提

- **Context**: cookies() async 化、middleware の Edge runtime 制約、Server Actions での session 取得
- **Alternatives Considered**:
  1. v0.4 系 + 自前 cookie wrap(Edge 互換性懸念回避策)
  2. NextAuth.js への切替(本 Issue 趣旨と乖離)
- **Selected Approach**: v0.5+ の公式パターンに沿って `lib/supabase/{server,client,middleware}.ts` を 3 ファイル分割で実装
- **Rationale**: Next.js 16 の async `cookies()` を v0.5+ は公式サポート / Issue 指定の依存
- **Trade-offs**: cookies adapter の実装が冗長になるが、保守は容易
- **Follow-up**: middleware が Edge runtime で起動することを検証、`postgres` 直接接続コードを混入させない

### Decision: D-2 — マイグレーションは 2 段階だがアプリ切替を Phase 1 にまとめる

- **Context**: Phase 1 適用後に旧版アプリが新カラムを知らないまま稼働すると新カラム NULL 行が生まれる
- **Alternatives Considered**:
  1. Phase 1 デプロイ後しばらく旧アプリが残る期間を許容(ダウングレード保護)
  2. **Phase 1(スキーマ追加)+ backfill + アプリ切替を同一デプロイサイクル**で通す
  3. Phase 1 / Phase 2 を 1 マイグレーションに統合
- **Selected Approach**: 案 2 を採用 — Phase 1 マイグレーション → backfill apply → アプリ切替 PR を **同一デプロイにまとめる**。Phase 2(旧 DROP)はその後の検証完了後に別デプロイ
- **Rationale**: 案 1 は新カラム NULL 行発生のリスク、案 3 は backfill とテーブル変更が同一トランザクションでない限り危険(分散ステップで失敗時の修復困難)
- **Trade-offs**: 単一 PR が大きくなるが、データ整合性を最優先
- **Follow-up**: タスク分割で Phase 1 タスクと「アプリ側担当者切替」タスクを 1 つのデプロイにグルーピングする旨をタスク `_Boundary:_` に明記

### Decision: D-3 — メールテンプレートは React Email 不採用、自前 JSX → HTML 文字列化

- **Context**: テンプレート 3 種(完了 / 失敗 / リマインダー)+ 共通レイアウトのみ
- **Alternatives Considered**:
  1. `@react-email/components` 採用(リッチな UI コンポーネント)
  2. **自前 JSX をサーバー側で `renderToStaticMarkup` で HTML 化**
- **Selected Approach**: 案 2 — `lib/email/templates/` に React JSX として書き、`renderToStaticMarkup`(`react-dom/server`)で HTML を生成
- **Rationale**: 3 テンプレートのみで `react-email` 依存追加は過剰、tech.md の「外部ライブラリは原則禁止」規約に整合
- **Trade-offs**: 高度なメール UI(buttons, columns)を作る場合は再検討余地あり
- **Follow-up**: 件名 / 本文の文言レビューはタスクで個別実施

### Decision: D-4 — Mock 経路では認証バイパス + 固定 mock profile を注入

- **Context**: `USE_MOCK_DB=true` のローカル開発で Supabase に依存させたくない
- **Alternatives Considered**:
  1. Mock 経路でも Supabase ローカルインスタンス起動を要求
  2. **middleware が Mock モード時は固定 profile (`PLACEHOLDER_DEV_PROFILE_ID`) を request に注入し、`getCurrentSession()` / `getCurrentProfile()` も同 profile を返す**
- **Selected Approach**: 案 2
- **Rationale**: ローカル開発の摩擦最小、`@supabase/ssr` 起動失敗で開発が止まらない
- **Trade-offs**: 認証フロー本体は Mock 経路で実検証できない → CI / staging で検証
- **Follow-up**: `lib/mock/seed.ts` に `PLACEHOLDER_DEV_PROFILE_ID` の seed プロフィールを定義

### Decision: D-5 — placeholder profile の email は `*@local.invalid`、`EmailClient.send()` で誤配信ガード

- **Context**: バックフィルで生成される placeholder profile に本物のメールが届くと混乱
- **Alternatives Considered**:
  1. placeholder の email カラムを NULL 許容にする(UNIQUE 制約と不整合)
  2. **`placeholder-{slug}@local.invalid` 形式 + `EmailClient.send` 内で `@local.invalid` を no-op 扱い**
- **Selected Approach**: 案 2
- **Rationale**: UNIQUE 制約を守りつつ誤配信を防ぐ二重ガード
- **Trade-offs**: 将来 Admin がマージ機能を追加する際、`@local.invalid` を本物 email に書換える運用が必要
- **Follow-up**: マージ UI(別 Issue)実装時のガイドラインを README に予約記述

### Decision: D-6 — `lib/domain/staff.ts` の `PLANNERS` / `SALES` / `CURRENT_USER` を削除、`OPS_MEMBERS` は暫定維持(2026-05-10 修正)

- **Context**: profile 中心の世界観に移行する以上、ハードコード定数は不要。ただし handoff 関連(`ops_assignee`)の user 参照化は本仕様の Out of Boundary であり、`OPS_MEMBERS` を削除すると handoff フォームが破壊される
- **Alternatives Considered**:
  1. 全削除し、`lib/queries/profiles.ts` の `getAllProfiles()` で代替(初期案)
  2. **`PLANNERS` / `SALES` / `CURRENT_USER` のみ削除し、`OPS_MEMBERS` は handoff 仕様の user 参照化 (別 Issue) まで暫定維持**(修正後)
- **Selected Approach**: 案 2(2026-05-10 design review で初期案を修正)。ファイル自体は残し、削除対象に `@deprecated` コメントで移行先を案内、`OPS_MEMBERS` には「handoff 関連が user 参照化されるまで維持」という保留コメントを付与
- **Rationale**: 本仕様の Boundary を逸脱せず、handoff 機能の破壊を回避。Single source of truth は段階的に profiles に集約
- **Trade-offs**: `lib/domain/staff.ts` 内に新旧定数が混在するが、`@deprecated` コメントで意図を明示できる
- **Follow-up**:
  - タスクで `grep -r "PLANNERS\|SALES\b\|CURRENT_USER" --include='*.ts' --include='*.tsx'` の結果を一掃する作業を含める
  - `OPS_MEMBERS` 参照は handoff 仕様の user 参照化 Issue で別途片付ける

## Synthesis Outcomes

### Generalization

- **G-1**: 「ジョブ完了通知 (Req 5)」と「商談リマインダー (Req 6)」は **`EmailClient.send(EmailMessage)` という単一抽象** で表現可能。送信元(Cron / Job hook)を変えるだけで両方をカバー
- **G-2**: 「triggered_by の uuid 化 (Req 5.1)」と「notifications.user_id 追加 (Req 7.1)」は **どちらも「既存テーブルにユーザー参照カラムを追加」** という同パターン → マイグレーション 0004 に同居可能
- **G-3**: profile 自動生成は **アプリ層に責務を持たせず Postgres trigger に閉じる**。これにより Mock 経路でも「手動で profile を seed する」だけで等価動作

### Build vs. Adopt

- **Auth**: Adopt(`@supabase/ssr` の公式 SSR パターンを採用)
- **OAuth provider**: Adopt(Supabase Auth + Google 標準連携)
- **Email send**: Adopt(Resend SDK)
- **Email templates**: Build(自前 JSX → HTML、3 テンプレートのみのため依存追加コスト > 利益)
- **Cron**: Adopt(Vercel Cron Hobby プラン 2 件枠)
- **Profile auto-create**: Adopt(Postgres trigger、Supabase 標準パターン)
- **Repos pattern**: Adopt(既存 `buildRepos()` を拡張)

### Simplification

- **S-1**: `lib/notifications/` ディレクトリは作らない。メール = 通知チャネルなので `lib/email/` に集約。アプリ内通知は `NotificationRepository` 経由で扱う
- **S-2**: `lib/auth/` も作らない。`lib/supabase/` が認証 / セッション抽象を兼ねる
- **S-3**: `Profile` の Server Action(`updateProfile` 等)は本仕様で作らない(要件にない)。`auth-actions.ts` には `signOutAction` のみ
- **S-4**: `STAFF` 系定数は段階廃止ではなく一括削除(`@deprecated` コメントだけ残す)
- **S-5**: `notifications` テーブル本体の責務分担は迷わず #14 に振る。本仕様は user_id カラム追加責務のみで設計を完結

## Risks & Mitigations(更新)

- **R1**(維持): `@supabase/ssr` v0.5+ × Next.js 16 cookies async — 設計は v0.5+ 公式パターン準拠、検証は早期実施
- **R2**(維持): バックフィル placeholder 量産 — dry-run + マッピングプレビュー必須化、マッピング表のレビューを Phase 1 デプロイ前に挿入
- **R3**(更新): Phase 1 / Phase 2 間ダウングレード問題 → D-2 で「アプリ切替を Phase 1 と同デプロイ」運用に統合
- **R4**(維持): Vercel Cron Hobby 枠 1 日 2 回 — 本仕様の 2 件 で枠ぴったり、超えたら pg_cron 移行
- **R5**(維持): 自由登録メンバー外流入 — README 注意明記
- **R6**(更新): `CURRENT_USER` 削除漏れ — D-6 のとおり一括削除、`pnpm typecheck` でガード、加えて `grep "CURRENT_USER\|PLANNERS\|SALES\|OPS_MEMBERS" --include='*.ts' --include='*.tsx'` のクリーンアップタスクを設置
- **R7**(更新): #14 連携の責務分担 — design.md §Boundary Commitments に明記、#14 が `notifications` テーブル新設時に user_id を含むかどうかの **どちらでも対応可能な設計** とした
- **R8**(維持): Mock 経路で認証 / メール no-op の整合性 — D-4 で固定 mock profile + email no-op で開発体験を保つ

## References

- Issue #16: 元の要件と技術選定根拠
- `requirements.md`: EARS 要件 + Boundary Context
- `lib/repositories/index.ts:81-139`: `buildRepos()` 規約(本仕様も準拠)
- `lib/db/schema.ts:1-12`: 既存スキーマ規約コメント
- `tech.md`: Cache Components / Repository Pattern / Server Actions 規約
- `structure.md`: 依存方向と命名規約
- `node_modules/next/dist/docs/`: Next.js 16 middleware / cookies 公式ガイド(参照予定)

