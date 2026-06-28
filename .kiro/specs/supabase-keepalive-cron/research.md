# Research & Design Decisions — supabase-keepalive-cron

## Summary
- **Feature**: `supabase-keepalive-cron`
- **Discovery Scope**: Simple Addition (single GitHub Actions workflow file) + 1 critical external-fact verification
- **Key Findings**:
  1. Supabase Free Tier の pause タイマーをリセットするのは **「user database activity（実 DB クエリ）」のみ**。Auth サーバの health や API gateway への単純アクセスは DB に到達せず、pause 予防として機能しない恐れが高い。
  2. ゆえに Issue #147 の literal 提案（`/auth/v1/health` + `/rest/v1/` ルートを curl）では **予防効果が不確実**。実績ある OSS（travisvn/supabase-pause-prevention, 4k★超）も「実テーブルへの DB クエリ」を採用している。
  3. 本リポジトリには既に GitHub Actions secret `DATABASE_URL`（本番 Supabase pooler 直結、`migrate.yml` で稼働実績）が存在する。これを再利用して `SELECT 1` を投げれば、新規 secret 登録なしに確実な DB activity を生成できる。

## Research Log

### Q1: Supabase Free Tier の pause タイマーは何でリセットされるのか
- **Context**: 本機能の有効性そのものを左右する最重要前提。Issue は auth/REST ping を提案していたが、それで pause が防げるか未検証だった（requirements.md の Adjacent expectations に検証必須と明記済み）。
- **Sources Consulted**:
  - Supabase 公式: Project Pausing ガイド（https://supabase.com/docs/guides/platform/free-project-pausing）
  - travisvn/supabase-pause-prevention（OSS, 実績ある回避策, https://github.com/travisvn/supabase-pause-prevention）
  - 複数の技術記事（Medium / DEV / levelup.gitconnected の GitHub Actions 解法）
- **Findings**:
  - 公式の正確な文言: **"A Free plan project is considered inactive if it does not receive sufficient *user database activity* over the past 7-day period."**
  - 補足: "Typically a few user requests to the database each day over the previous week is enough to keep the project from being paused."
  - 判定対象は **データベースへのアクセス**。ダッシュボード閲覧やアプリ URL 訪問はカウントされない。
  - OSS の確立解は「専用 `keep-alive` テーブルへの実クエリ（select/insert）」。health endpoint ping ではなく DB に届くクエリを使う。
- **Implications**:
  - keep-alive の **load-bearing アクション = 実 DB クエリ**でなければならない。
  - `/auth/v1/health`（Auth サーバ health, DB 非到達）と `/rest/v1/` ルート（PostgREST の OpenAPI spec 返却で DB クエリにならない可能性）は load-bearing には不適。
  - REST 経由で実テーブルを読む（`GET /rest/v1/<table>?select=...&limit=1`）なら PostgREST→Postgres に到達し DB activity になるが、anon key の到達可否（RLS/GRANT）に依存する。

### Q2: 本リポジトリの DB アクセス構成と既存 secret
- **Context**: keep-alive の実装手段（REST anon key か、DB 直結か）を決めるため。
- **Sources Consulted**: `lib/db/schema.ts`, `drizzle/*.sql`, `.github/workflows/migrate.yml`, プロジェクトメモリ。
- **Findings**:
  - テーブル: `stores`, `deals`, `handoffs`, `notifications`, `profiles`, `research`, `research_jobs`, `research_reports`, `app_settings`, `ai_prompt_templates`。
  - RLS は `ai_prompt_templates` のみ有効。本体アクセスは Drizzle + `DATABASE_URL`（本番 pooler 直結, server-side）。anon key + RLS はアプリの主要アクセス経路ではない。
  - GitHub Actions secret `DATABASE_URL` が既に登録され、`migrate.yml` が本番 pooler に対して稼働中（メモリ: Session Pooler が CI 必須）。
  - GitHub-hosted `ubuntu-latest` には `psql`(postgresql-client) がプリインストールされている。
- **Implications**:
  - `DATABASE_URL` を再利用し `psql "$DATABASE_URL" -c "select 1"` を実行すれば、RLS/anon 到達性に一切依存せず確実な DB activity を生成できる。
  - 新規 secret（`SUPABASE_URL`/`SUPABASE_ANON_KEY`）の登録が **不要**になり、Issue DoD の secret 登録ステップが簡素化される。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| A. `psql SELECT 1` via `DATABASE_URL`（採用） | 既存 secret で本番 pooler に直結し最小クエリを実行 | 確実な DB activity / 新規 secret 不要 / RLS 非依存 / `pnpm install` 不要で軽量 | DB 認証情報を CI で使用（既に migrate.yml で使用済みのため増分リスクなし） | 最も堅牢かつ最小 |
| B. REST anon query `GET /rest/v1/<table>?limit=1` | Issue に近い。anon key で PostgREST 経由テーブル読取 | DB 認証情報不要 / Issue 提案に近い | anon 到達性(RLS/GRANT)に依存 / 新規 secret 2 本 / 特定テーブルへ結合 | DB activity にはなるが前提依存が多い |
| C. `/auth/v1/health` ping（Issue literal） | Auth サーバ health を叩くだけ | 最小実装 | **DB に到達せず pause 予防にならない恐れ** | 不採用（有効性が公式定義と矛盾） |
| D. 専用 `keep-alive` テーブル + migration | travisvn 方式。専用テーブルに insert/select | 最も明示的な DB activity | migration 追加 / RLS policy / 運用面の moving parts 増 | 本リポには過剰 |

## Design Decisions

### Decision: load-bearing アクションは `DATABASE_URL` 経由の `SELECT 1`
- **Context**: Free Tier pause は「user database activity」でのみリセットされる（Q1）。Issue の auth/REST ping では効果が不確実。
- **Alternatives Considered**:
  1. Option B（REST anon query）— DB に届くが anon 到達性に依存、新規 secret 2 本。
  2. Option C（auth health ping）— Issue literal。DB 非到達で無効の恐れ。
  3. Option D（専用テーブル + migration）— 過剰。
- **Selected Approach**: GitHub Actions の cron(5 日周期)+`workflow_dispatch` で `psql "$DATABASE_URL" -c "select 1"` を実行。成功で green、失敗(接続不可/エラー/timeout)で red。
- **Rationale**: 確実な DB activity を最小構成で生成。`DATABASE_URL` は登録済みで新規 secret 不要。RLS/anon 構成から完全に独立。`pnpm install` 不要で `migrate.yml` より軽量・高速。
- **Trade-offs**: CI で DB 認証情報を使うが、`migrate.yml` が既に同 secret を本番に対して使用しており増分の blast radius はゼロ。`SELECT 1` はテーブル無依存だが、確実な接続+クエリ実行で activity として十分（公式は "requests to the database" を要件とし特定テーブルを要求しない）。
- **Follow-up**:
  - Req 7 の検証で、手動実行 green 後に実運用で pause が再発しないことを複数周期にわたり確認する。
  - 万一 `SELECT 1`（テーブル非接触）が Supabase 監視で activity 計上されない兆候があれば、`select 1 from <existing_table> limit 1` 等のテーブル読取に切替（design の Open Questions に記載）。

### Decision: Issue DoD の secret 要件を `DATABASE_URL` 再利用に置換
- **Context**: Issue は `SUPABASE_URL`/`SUPABASE_ANON_KEY` 登録を DoD にしていたが、採用設計では不要。
- **Selected Approach**: 既存 `DATABASE_URL` secret を再利用。新規 secret 登録を DoD から除外し、「`DATABASE_URL` が登録済みであることの確認」に置換。
- **Rationale**: 重複 secret を増やさず、本番アプリ/migration と同一接続情報に一元化（drift 防止 = Req 5.2 の意図に合致）。
- **Trade-offs**: Issue の文面と差異が出るため、PR/Issue コメントで設計判断（公式 pause 定義に基づく逸脱）を明記する必要がある。

## Risks & Mitigations
- **R1: `SELECT 1` が activity 計上されない可能性（低）** — 公式は "requests to the database" を要件とし、接続+クエリは該当。万一に備えテーブル読取へ切替可能な設計にしておく（Open Questions）。実運用での pause 不再発を Req 7 で確認。
- **R2: pooler が psql 接続を拒否/IP 制限** — `migrate.yml` が同 `DATABASE_URL` で本番に到達済みのため到達性は実証済み。timeout(5 分)で無限ハング防止。失敗時は red+通知。
- **R3: 設計が Issue 文面と乖離** — research の根拠（公式 pause 定義）を design の Boundary/Open Questions と PR 説明に明記し、レビュー時に合意を取る。
- **R4: secret 漏洩** — `DATABASE_URL` を echo せず、psql には環境変数経由で渡しログに平文出力しない（Req 5.4）。

## References
- [Supabase Docs — Project Pausing](https://supabase.com/docs/guides/platform/free-project-pausing) — 公式 pause 定義（"user database activity over the past 7-day period"）
- [travisvn/supabase-pause-prevention](https://github.com/travisvn/supabase-pause-prevention) — 実テーブルクエリによる確立した回避策
- [Medium: Prevent Supabase Free Tier Pausing (2026)](https://shadhujan.medium.com/how-to-keep-supabase-free-tier-projects-active-d60fd4a17263) — DB クエリのみが activity という解説
- 既存 `.github/workflows/migrate.yml` — 本リポの GitHub Actions + `DATABASE_URL` secret 作法の先例
