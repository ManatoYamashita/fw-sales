# Implementation Plan — deep-research-pipeline

- [ ] 1. Foundation: PoC・DB スキーマ・基盤インタフェース整備
- [ ] 1.1 Phase 0 PoC: Gemini Deep Research SDK・cancelTask・gemini-2.5-flash-lite の実機検証
  - `@google/genai@1.52.0` で `interactions.create({background:true})` / `interactions.get(taskName)` / cancel に相当するメソッドの実体を確認
  - `gemini-2.5-flash-lite` の正式モデル ID と `responseJsonSchema` 動作確認
  - `lib/auth/*`（または同等）に `getCurrentUser` 相当のヘルパが存在するか実体確認
  - 観測可能完了: `spike/deep-research-poc.ts`（コミット対象外）を 1 件サンプル店舗で実行し成功ログを research.md に追記、SDK 実体に基づく差分があれば design.md の `DeepResearchClient` interface 章を更新
  - _Requirements: 2.1, 3.1, 5.4, 6.1, 8.1_
  - _Blocked: PoC 実行は GEMINI_API_KEY を持つ運用ユーザーが手動で実施する必要あり。spike 雛形 + 実行手順は研究ログ (research.md §Phase 0 PoC Execution Log) に反映済。認証ヘルパは `lib/supabase/server.ts:99-128` の getCurrentSession/getCurrentProfile と判明済 (design.md 側で正しい関数名に置換)_

- [x] 1.2 Drizzle マイグレーション 0008（research_jobs + research_reports）作成
  - design.md §Physical Data Model の通り 2 テーブルを定義（status / FK / 9 jsonb 列 / index 4 件 + UNIQUE 1 件）
  - `notifications` 既存スキーマには触らない（kind は text のまま）
  - 観測可能完了: `drizzle/0008_add_deep_research.sql` が生成され、ローカル DB へ `pnpm drizzle:migrate` 適用後 `\d research_jobs` / `\d research_reports` で全カラム・インデックス確認できる
  - _Requirements: 1.1, 2.3, 5.3, 5.4, 8.1, 8.3, 8.4_

- [x] 1.3 DeepResearchRepository インタフェース・Mock 実装・TxRepos 統合
  - design.md §Components and Interfaces / deepResearchRepository の 12 メソッドすべて実装（`claimOldestQueued` は `FOR UPDATE SKIP LOCKED` を Drizzle `sql` template で）
  - `lib/mock/` に Mock 実装、`lib/repositories/index.ts` の `TxRepos` 型と `repos` build に追加
  - 観測可能完了: `repos.transaction(async ({ deepResearch }) => { /* insert + get */ })` が型エラーなく動き、Mock で 1 件ジョブ作成→取得→状態更新が往復成功
  - _Requirements: 1.2, 2.3, 5.5, 8.3_

- [x] 1.4 (P) CACHE_TAGS 拡張と環境変数ヘルパ追加
  - `lib/cache.ts` に `deepResearchByStore(storeId)` / `deepResearchJob(jobId)` を追加
  - `lib/env.ts` に `getDeepResearchModel()` / `assertCronSecret()` / `getInFlightCap()`（default 10）/ `getPollPerTick()`（default 5）/ `getDailyUserCap()` / `getMonthlyCap()` を追加
  - 観測可能完了: 各ヘルパが型 export され、`assertCronSecret()` が env 未設定で throw、設定済で値を返す動作を直接実行で確認できる
  - _Requirements: 6.1, 6.2, 6.4_
  - _Boundary: lib/cache.ts, lib/env.ts_

- [ ] 2. Core: AI クライアント層（共通基盤抽出 + Deep Research + Structurer）
- [x] 2.1 共通 JSON Schema ユーティリティの抽出（既存挙動不変リファクタ）
  - `lib/ai/_shared/json-schema-utils.ts` を新設し `stripUnsupportedKeys` / propertyOrdering ヘルパを既存 `lib/ai/schema.ts` から移送
  - `lib/ai/client.ts` / `lib/ai/schema.ts` の import を切替、既存呼出元の挙動を一切変えない
  - 観測可能完了: `pnpm typecheck && pnpm lint` 緑、既存同期 AI 分析を 1 店舗で実行して 5 項目出力（`strengths_markdown` 等）が以前と同一
  - _Requirements: 3.1_
  - _Boundary: lib/ai_

- [ ] 2.2 (P) DeepResearchClient 実装（Stage 1 SDK ラッパ）
  - `startTask` / `getTask` / `cancelTask` の 3 メソッド、`DeepResearchClientError` / `DeepResearchCancelResult` discriminated union
  - SDK 生エラーから API キー文字列・request ID を除去する `normalizeSdkError` パターン継承
  - cancelTask は SDK 非対応時 `{ cancelled: false, reason: "unsupported" }` を返す best-effort
  - 観測可能完了: PoC で確認したシグネチャに沿って 3 メソッドが呼出可能、エラー入力時に生 API キーが文字列に含まれない（テストで確認）
  - _Requirements: 3.1, 3.6, 5.4, 6.6_
  - _Boundary: lib/ai/deep-research_
  - _Depends: 1.1, 2.1_
  - _Blocked: 1.1 (PoC) が GEMINI_API_KEY 未確保のため Blocked。SDK 実体シグネチャが未確定のため、PoC 完了後に再開する。研究ログとデザインに想定 SDK interface は記載済_

- [x] 2.3 (P) DeepResearch スキーマ・51 項目キー定数定義
  - 8 カテゴリ × 51 項目の Zod スキーマと項目キー（snake_case）→ラベル正規化マップ
  - tier=B で confidence/source_urls/source_quote 必須、tier=C で hearing_question 必須を `refine` で検証
  - `getDeepResearchJsonSchema()` で Gemini 用 JSON Schema を返す
  - 観測可能完了: B 区分で confidence 欠落・C 区分で hearing_question 欠落の入力を `safeParse` すると `schema_violation` が返る Unit Test 緑
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_
  - _Boundary: lib/ai/deep-research_
  - _Depends: 2.1_

- [x] 2.4 (P) DeepResearch プロンプト構築
  - System prompt + User prompt builder。51 項目の取得指示、A/B/C 区分付与指示、C 項目の `hearing_question` 生成指示を含む
  - 店舗の基本情報（name / address 等）を user prompt に埋め込む
  - 観測可能完了: `buildDeepResearchPrompt({ store })` が決定的な文字列を返し、51 項目キー名と A/B/C 凡例が prompt 内に必ず含まれる
  - _Requirements: 3.1, 3.2, 3.4_
  - _Boundary: lib/ai/deep-research_

- [x] 2.5 Structurer 実装（Stage 2 構造化）
  - `gemini-2.5-flash-lite` を `responseMimeType: "application/json"` + `responseJsonSchema` で呼ぶ
  - 出力テキストを `JSON.parse` → Zod `safeParse` の二段検証
  - `StructurerError` discriminated union
  - 観測可能完了: モック SDK で正常 Markdown → 51 項目 JSON 変換成功、スキーマ違反入力で `schema_violation` を返すテストが緑
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_
  - _Boundary: lib/ai/deep-research_
  - _Depends: 2.1, 2.3_

- [ ] 3. Core: Server Actions・Queries・通知ヘルパ
- [x] 3.1 (P) enqueueDeepResearchAction / retryDeepResearchAction
  - 認証 → 必須項目 → 重複ジョブ → 日次上限 → 月次上限 の順にチェックし、失敗時は `ActionResult.failure(message)` を返す
  - 成功時 `repos.transaction` で `research_jobs` に `queued` 行を作成し `revalidateTag(CACHE_TAGS.deepResearchByStore(storeId))`
  - `retryDeepResearchAction` は `failed` 行を読んで新規 `queued` 行を作る（元行は touch しない）
  - 観測可能完了: 4 種の失敗ケース（未認証・必須欠落・重複・上限超過）と正常ケースを Action 直接呼出で確認、それぞれ意図した `ActionResult` を返す
  - _Requirements: 1.1, 1.2, 1.3, 1.5, 5.5, 5.6, 6.1, 6.2_
  - _Boundary: lib/actions_
  - _Depends: 1.3, 1.4_

- [x] 3.2 (P) getDeepResearchReport / getDeepResearchJobByStore queries
  - `'use cache'` + `cacheTag(CACHE_TAGS.deepResearchByStore(storeId))`
  - レポート取得時に `getCurrentUser()` + 店舗閲覧権限チェック（未認可なら null）
  - 観測可能完了: 認可済ユーザーで最新レポート取得が成功、未認可ユーザーでは `null` 返却を Unit Test で確認
  - _Requirements: 5.2, 7.5_
  - _Boundary: lib/queries_
  - _Depends: 1.3, 1.4_

- [x] 3.3 (P) createDeepResearchNotification ヘルパ（in-app 限定 + 管理者 fan-out）
  - 3 種類の `kind` (`deep_research_done` / `deep_research_failed` / `deep_research_budget_warning`) を `notifications` テーブルに insert する関数
  - `deep_research_done` / `deep_research_failed` は対象店舗の登録ユーザー 1 名宛
  - `deep_research_budget_warning` は `profiles.role = 'admin'` を引いた全管理者ユーザーへ fan-out（副関数 `findAdminUsers()` を `profileRepository` 経由で呼出。新規メソッドが必要なら同タスク内で追加）
  - メール・Slack・LINE 等の外部チャネルは呼ばない（R4.4 を構造的に担保）
  - 観測可能完了: 3 種類の kind それぞれで `notifications` テーブルに行追加され、`deep_research_budget_warning` では admin 件数分の行が同時 insert されることを SQL で確認
  - _Requirements: 4.1, 4.2, 4.4, 6.3, 7.4_
  - _Boundary: lib/db/notification-helpers, lib/repositories/profile-repository_
  - _Depends: 1.3_

- [x] 3.4 (P) getRecentNotifications query（NotificationBell 用）
  - `lib/queries/notification.ts` 等に `'use cache'` 関数を新設し、ログインユーザーの最新通知 N 件（default 10、新しい順）を返す
  - `cacheTag(CACHE_TAGS.notifications)` を付与し、`createDeepResearchNotification` 呼出後の `revalidateTag` で SWR
  - 観測可能完了: 認可済ユーザー A に対し A 宛通知のみが新しい順で返り、他ユーザー宛 / null user_id（全員向け）も含めて 10 件に制限される
  - _Requirements: 4.1, 4.2, 4.3_
  - _Boundary: lib/queries/notification_
  - _Depends: 1.3, 1.4_

- [ ] 4. Core: パイプライン API と GitHub Actions cron
- [ ] 4.1 pollResearchEndpoint 実装（55s deadline + 3 ステージ）
  - Bearer `CRON_SECRET` 認可（失敗時 401）、`maxDuration = 60`、`deadline = Date.now() + 55_000`
  - Stuck sweep → Polling fan-out（最大 `DEEP_RESEARCH_POLL_PER_TICK`）→ Start fan-in（in-flight < `DEEP_RESEARCH_MAX_IN_FLIGHT`）の 3 ステージを順次実行
  - sweep では `cancelTask` を best-effort で呼出、結果を `error_log.cancel_result` に記録（R5.4）
  - 自動リトライは行わない（R5.6）— 再実行は `retryDeepResearchAction` のみ
  - 長時間 Stage 1 (数十分〜数時間) を許容、複数ジョブ並走可（R2.4）
  - 完了時 `createDeepResearchNotification` を呼ぶ、月次 80% 超過時に `deep_research_budget_warning` を発火（R6.3）
  - 観測可能完了: `curl -H "Authorization: Bearer $CRON_SECRET" -X POST /api/cron/poll-research` が `200 { swept, polled, completed, started, deadline_reached }` を返し、認可ヘッダなしで 401 が返る
  - _Requirements: 2.1, 2.2, 2.4, 2.5, 4.1, 4.2, 4.4, 5.3, 5.4, 5.6, 6.3, 6.4, 6.5, 6.6, 8.2, 8.4_
  - _Boundary: app/api/cron, lib/ai/deep-research, lib/repositories_
  - _Depends: 1.3, 1.4, 2.2, 2.5, 3.3_

- [ ] 4.2 GitHub Actions workflow ファイル作成と運用者ハンドオフ
  - `.github/workflows/poll-research.yml` を作成: `*/30 * * * *` + `workflow_dispatch` + 週次 noop ping（毎週月曜 00:00 UTC に `echo "keepalive"` のみ実行する別 job、60 日無活動回避）
  - workflow YAML 内のヘッダコメントに、`CRON_SECRET`（最低 32 バイトランダム生成手順）と `VERCEL_URL` を GitHub Secrets / Vercel Env Vars 双方に登録する運用手順を明記（実際の登録は運用ユーザーが GitHub UI / Vercel UI で実施するため、コード成果物は YAML + 手順コメントまで）
  - 観測可能完了: workflow YAML がリポジトリにマージされ、運用者が secrets 登録後の `workflow_dispatch` 手動実行で `/api/cron/poll-research` が 200 を返す（secrets 登録自体はコード成果物の範囲外）
  - _Requirements: 2.1, 6.4, 8.2_
  - _Boundary: .github/workflows_
  - _Depends: 4.1_

- [ ] 5. Core: UI コンポーネント
- [x] 5.1 (P) ResearchStatusBadge コンポーネント
  - 5 状態（queued / researching / structuring / done / failed）の Badge を `data-status` 属性で色決定（既存 `stage-badge.tsx` パターン）
  - 観測可能完了: 5 状態それぞれで視覚的に区別された Badge が描画されるストーリーブック相当の確認（Playwright スナップショット or 手動）
  - _Requirements: 5.1, 2.3_
  - _Boundary: components/feature_

- [x] 5.2 DeepResearchEnqueueButton（Client Component, CTA + 状態 + 再投入）
  - `currentJob: DeepResearchJob | null` を props に取り、null / 進行中 / failed の 3 状態で表示分岐
  - `useTransition` + `useToasts` でフィードバック、`enqueueDeepResearchAction` / `retryDeepResearchAction` を呼ぶ
  - 観測可能完了: 進行中なら disabled、null なら CTA、failed なら「再投入」ラベルで Action 呼出 → Toast 表示
  - _Requirements: 1.1, 5.1, 5.5_
  - _Boundary: app/(main)/stores/[id]/_components_
  - _Depends: 3.1, 5.1_

- [x] 5.3 (P) DeepResearchReportView（RSC, 8 カテゴリ × 51 項目表示 + 凡例）
  - Tabs プリミティブで 8 カテゴリ切替、各項目に tier Badge / confidence / source_urls リンク / source_quote / hearing_question
  - 画面上部に A/B/C 凡例と最終生成日時を表示（R7.3）
  - 観測可能完了: レポートを持つ店舗で全 51 項目が 8 タブで閲覧可、未充足項目もスケルトン表示で可視化される
  - _Requirements: 3.1, 3.5, 7.3_
  - _Boundary: app/(main)/stores/[id]/_components_

- [x] 5.4 DeepResearchTab + store-detail-tabs.tsx 拡張（4 タブ目を追加）
  - `deep-research-tab.tsx` で表示分岐（レポートあり → `DeepResearchReportView` / 進行中 → 状態 + CTA disabled / なし → CTA active）
  - `store-detail-tabs.tsx` に「Deep Research」タブを追加、既存 3 タブ（基本情報・補足情報・AI 分析）の動作は不変
  - 観測可能完了: 店舗詳細画面で 4 タブが見え、Deep Research タブの中身が R5.2 のレポート存在状態に応じて切替、既存 AI 分析タブの 5 項目表示が変わらない
  - _Requirements: 5.1, 5.2, 7.1, 7.2_
  - _Boundary: app/(main)/stores/[id]/_components_
  - _Depends: 5.2, 5.3, 3.2_

- [x] 5.5 (P) NotificationBell + topbar 統合
  - `components/layout/notification-bell.tsx` で Client Component、未読件数 Badge、ドロップダウンで最新 10 件表示
  - `topbar.tsx` 既存 Bell スタブ箇所に `NotificationBell` をマウント
  - `kind === "deep_research_done"` / `"deep_research_failed"` のクリックで該当店舗の Deep Research タブへ遷移
  - 観測可能完了: ヘッダーの Bell をクリックで通知一覧が開き、`deep_research_done` 通知から店舗詳細の Deep Research タブへ 1 アクションで到達できる（R4.3）
  - _Requirements: 4.1, 4.2, 4.3_
  - _Boundary: components/layout_
  - _Depends: 3.3, 3.4_

- [ ] 6. Integration & Validation
- [ ] 6.1 (P) deepResearchRepository 単体テスト
  - 状態遷移許容ペア / 重複検出（`findActiveByStore`）/ 日次集計（`countByUserSinceDay`）/ 月次集計（`countByMonth`）/ スタック検出（`findStuckJobs`）の 5 ケース
  - 観測可能完了: `pnpm test lib/repositories/deep-research-repository.test.ts` が 5 ケース緑
  - _Requirements: 1.2, 2.3, 5.4, 5.5, 6.1, 6.2, 8.3_
  - _Boundary: lib/repositories_
  - _Depends: 1.3_

- [ ] 6.2 (P) パイプライン統合テスト（モック SDK で 4 シナリオ）
  - シナリオ A: enqueue → cron tick で Stage 1 起動 → 後続 tick で polling → completed → Stage 2 → `done` + 通知作成
  - シナリオ B: Stage 1 failed → `failed` + 失敗通知
  - シナリオ C: Stage 2 で `schema_violation` → `failed` + 失敗通知
  - シナリオ D: 並走 2 cron tick が同一 `queued` ジョブを `FOR UPDATE SKIP LOCKED` で二重起動しない
  - シナリオ E: 6h 経過 `researching` を sweep が `cancelTask` 呼出 → `failed` + cancel 結果を error_log に記録
  - 観測可能完了: 5 シナリオすべて緑
  - _Requirements: 2.1, 2.5, 3.1, 4.1, 4.2, 5.4, 6.6_
  - _Boundary: app/api/cron, lib/ai/deep-research_
  - _Depends: 4.1_

- [ ] 6.3 (P) UI E2E と area-search 非露出スナップショット
  - 店舗詳細「Deep Research」タブから enqueue → Toast → 進行中バッジへの状態切替を Playwright/Cypress で確認
  - Notification Bell から `deep_research_done` 通知をクリック → 店舗詳細 Deep Research タブへ遷移
  - エリア検索画面（`/stores/new`）のスナップショットに「Deep Research を実行」ボタンが含まれないことを確認（R1.4）
  - 観測可能完了: E2E 3 シナリオすべて緑、area-search スナップショット差分なし
  - _Requirements: 1.4, 4.3, 5.1, 7.2_
  - _Boundary: app/(main)/stores_
  - _Depends: 5.4, 5.5_

- [ ] 6.4* (P) パフォーマンス計測（オプショナル）
  - `enqueueDeepResearchAction` の P95 < 5s（R1.5 検証）
  - `pollResearchEndpoint` 1 tick の P95 < 55s（Stage 2 完了パス含む、R2.5 検証）
  - 観測可能完了: 計測スクリプト実行で P95 値がログに出力され、各 SLA を満たす
  - _Requirements: 1.5, 2.5_
  - _Boundary: app/api/cron, lib/actions_
  - _Depends: 4.1, 3.1_

---

## Implementation Notes

- **Task 1.2 (drizzle 0008)**: `pnpm db:generate` の自動生成タグ (`0008_cute_ezekiel_stane`) を `0008_add_deep_research` にリネームする際、`drizzle/meta/_journal.json` の `tag` フィールドも合わせて更新が必須。これを忘れると `pnpm db:check` が失敗する（既知の Drizzle 孤児マイグレーションパターン）。
- **Task 1.3 (auth helper)**: design.md は `getCurrentUser()` 表記だが実体は `lib/supabase/server.ts:99-128` の `getCurrentSession()` / `getCurrentProfile()`。Task 3.1 (Server Actions) / 3.2 (Queries) 実装時にこの正しい関数名を使うこと。
- **Task 1.3 (DB repository)**: `claimOldestQueued` は Drizzle ORM ヘルパでは `FOR UPDATE SKIP LOCKED` を表現できないため `executor.execute(sql\`...\`)` で raw SQL を採用。返り値は `unknown as JobRow[]` キャストが必要。
- **Task 1.1 (PoC)**: SDK 実機呼出は agent 環境では実行不能 (API 課金リスク)。spike 雛形 + 実行手順は research.md に反映済。ユーザーが実行後、結果ログを research.md に追記し、SDK 想定との差分があれば design.md `DeepResearchClient` 章を更新する運用フローを確立。
- **Task 2.1 (json-schema-utils 抽出)**: 既存 `lib/ai/schema.ts:getAiAnalysisJsonSchema` の `stripUnsupportedKeys` をモジュール化したが、Gemini 非対応 key set (`$schema`/`maxLength` 等) は schema.ts と shared util の双方で値が一致することが必須。set 変更は shared util 側のみで完結させ、`schema.ts` は import のみで影響を受ける。
- **Task 2.3 (51 項目)**: Issue #43 §2 のテーブルは合計 50 行 (Issue の "51 項目" は集計 18+18+15=51 の表記揺れ)。実装では `TOTAL_ITEM_COUNT` で実数を export し、テストでは `>= 50` で許容。将来 1 項目追加で 51 件にする運用も可能。
- **Task 2.5 (Structurer テスト)**: SDK 呼出を含む関数はモック困難なので、`parseAndValidateStructurerText` を純関数として分離し、テストはそれに対して書く。SDK 呼出本体は Task 6.2 統合テストでカバーする方針。`StructuredReport` 型は `z.infer<typeof DeepResearchReportSchema>` でないと推論が `never` に落ちる (`ReturnType` + `extends` パターンは特殊フォームで動かない)。
- **Task 3.1 (Server Actions)**: Next.js 16 では `revalidateTag(tag, "max")` の第 2 引数 (profile) が必須。`revalidateTag(tag)` 単独呼出は型エラー (TS2554)。既存 `lib/actions/research-actions.ts` のパターンを踏襲すること。
- **Task 3.1 (テスト)**: `lib/env` を mock する際は `vi.mock(import("@/lib/env"), async (importOriginal) => { const actual = await importOriginal(); return { ...actual, ... }; })` で partial mock しないと `assertEnv` 等の他関数の export が消えて `lib/db/client.ts` 経由で実行時エラーになる。
- **Task 3.3 (型拡張)**: `ProfileRole` に `'admin'` を追加。既存 `asProfileRole` フェイルセーフ関数の更新と、`lib/db/profile-repository.ts` の `findAll({ excludePlaceholders: true })` を `inArray(["member", "admin"])` に変更する必要あり (member だけだと admin が漏れる)。
- **Task 3.3 (NotificationKind 拡張)**: `types/notification.ts` の `NotificationKind` に 3 値 (`deep_research_done` / `deep_research_failed` / `deep_research_budget_warning`) を追加。既存 2 値 (`research_job_completed` / `research_job_failed`) は #16 由来で現状未使用だが、型互換性のため残存させる。
- **Task 5.4 (design 乖離)**: design.md は「store-detail-tabs.tsx に 4 タブ目を追加」を想定していたが、実態の `app/(main)/stores/[id]/page.tsx` は Tabs 構造ではなくカード集約レイアウトだった (基本情報/AI 分析/調査/商談履歴 が縦並びカード)。タスク 5.4 は「DeepResearchSection カードを page.tsx の AiAnalysisDetailSection の直後に挿入」する形で実装。design 当初の「タブ」概念は `DeepResearchReportView` の内部 8 カテゴリ Tabs に降格 (R7.2 視覚的区別は別カードとして担保)。
- **Task 5 (UI テスト戦略)**: `@testing-library/react` が未導入のため、Task 5 各サブタスクは個別の vitest UI テストを書かず、typecheck + lint + `pnpm build` 成功 + Task 6.3 の E2E (Playwright/Cypress) で観測完了とする。`ResearchStatusBadge` は元々「ストーリーブック相当の確認 or 手動」が観測完了条件だったため整合。
- **Task 5.5 (Topbar 通知)**: `Topbar` を Client 維持しつつ `notifications?: readonly Notification[]` props を追加。`(main)/layout.tsx` の `TopbarShell` (RSC) が `getRecentNotifications(profile.id, 10)` の結果を props 経由で渡す。既存 Bell スタブを `<NotificationBell>` に置換。
