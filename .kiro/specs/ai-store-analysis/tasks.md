# Implementation Plan

## Major Task Map

1. **Foundation** — npm 依存追加、環境変数 helper、共通型拡張、DB スキーマ + マイグレーション、Mock SEED 更新
2. **AI Service Layer** — Zod スキーマ、Prompt Builder、Validator、Rate Limiter、Gemini Client
3. **URL Parser limited extension** — `OgpResult.html` 保持と運営者抽出、`applyParsedData` への operator マージ
4. **Server Actions** — `analyzeStoreAction` 新設、`createStoreAction` の operator + AI 結果対応拡張
5. **UI Layer** — `useBeforeUnload`、個人店バッジ、AI Panel の CTA / 結果表示、StoreNewForm 統合、店舗詳細・一覧での復元・バッジ
6. **Tests** — AI Service ユニット / URL Parser 拡張 / Server Action 統合
7. **Final verification** — 静的検証、PoC 実コスト計測、手動 E2E チェックリスト

---

## Tasks

- [x] 1. Foundation: dependencies, env, types, schema, mock seed

- [x] 1.1 npm 依存追加と環境変数 example 整備
  - `pnpm add @google/genai zod zod-to-json-schema` で 3 個追加
  - `.env.example` に `GEMINI_API_KEY=` および `GEMINI_MODEL=gemini-2.5-flash` を追記、未設定時の挙動コメントを併記
  - `package.json` の dependencies に 3 個が並び、`pnpm install` がエラーなく完了
  - _Requirements: 2.7_

- [x] 1.2 環境変数 helper の追加
  - `lib/env.ts` に Gemini 関連 env を取得する関数(既存 `readEnv` パターン踏襲)+ `isApiKeyConfigured(): boolean` を追加
  - Mock mode で評価されない lazy 評価を維持(現行 `assertEnv` 同様)
  - `import { isApiKeyConfigured } from "@/lib/env"` 経由で server / client 双方から API キー有無の boolean を取得できる
  - _Requirements: 2.7_

- [x] 1.3 共通型の拡張(OperatorType + Store + AiAnalysisResult re-export 用ファイル)
  - `types/store.ts` に `OPERATOR_TYPES = ["個人店", "複数店舗運営", "未設定"] as const` + `OperatorType` 型を追加、`Store` インターフェイスに `operator_type`, `operator_name`, `ai_analysis_result` 3 フィールドを追加
  - `types/ai-analysis.ts` を新規作成、後続 2.1 で実体定義される `AiAnalysisResult` / `AiAnalysisConfidence` / `ConfidenceFieldKey` の re-export 経路を用意(暫定 `export type AiAnalysisResult = unknown` でも可、2.1 で書き換え)
  - `pnpm typecheck` を走らせると Store 型に依存する既存ファイル(repositories / mock / actions / form)が新フィールド未対応で TypeScript エラーを出す(本タスクは fix を含まない、後続タスクで解消)
  - _Requirements: 1.5, 1.6, 5.1_

- [x] 1.4 DB スキーマ拡張と Drizzle マイグレーション
  - `lib/db/schema.ts` の `stores` テーブルに `operator_type text NOT NULL DEFAULT '未設定'`, `operator_name text NOT NULL DEFAULT ''`, `ai_analysis_result text` 列追加
  - `drizzle/0001_add_operator_and_ai_analysis.sql` を新規作成、`ALTER TABLE stores ADD COLUMN ...` を 3 行で記述
  - DOWN マイグレーション(`DROP COLUMN`)文を `drizzle/0001_*.down.sql`(または README/コメント)で手元に用意
  - DB 環境で `pnpm drizzle-kit push` 実行後、`SELECT operator_type, operator_name, ai_analysis_result FROM stores LIMIT 1` がエラーなく実行できる
  - _Requirements: 1.5, 1.6, 5.1_

- [x] 1.5 Mock SEED 更新と Mock パススルー確認
  - `lib/mock/seed.ts` の SEED_STORES 各レコードに `operator_type: "未設定"`, `operator_name: ""`, `ai_analysis_result: null` を追加
  - `lib/mock/store.ts` の `create` / `update` が新フィールドを passthrough することを確認(変更なし想定)
  - `pnpm seed` 実行後(Mock mode)、UI 経由で店舗詳細を開くと operator フィールドが空 / 未設定で表示され、AI 分析結果が null として扱われる
  - _Requirements: 1.5, 1.6_

---

- [ ] 2. AI Service Layer: schema, prompt, validate, rate-limit, client

- [ ] 2.1 Zod スキーマと JSON Schema 変換
  - `lib/ai/schema.ts` を新規作成、`AiAnalysisSchema`(5 フィールド `strengths_markdown` / `weaknesses_markdown` / `gourmet_paid_status` / `gbp_completeness` / `call_script` + `confidence` ネスト 5)を Zod で定義
  - `ConfidenceField = z.number().int().min(0).max(100)`、`call_script` に `.max(1500)`、`AiAnalysisSchema` を `.strict()` で extra prop 拒否
  - `getAiAnalysisJsonSchema(): Record<string, unknown>` で `zod-to-json-schema` 変換 + `propertyOrdering` 配列を埋込
  - `types/ai-analysis.ts` から re-export(`AiAnalysisResult`, `AiAnalysisConfidence`, `ConfidenceFieldKey`)
  - スキーマ定義ファイルを単独で import すると、正しい入力で `AiAnalysisSchema.parse(...)` が成功し、不正入力で例外を投げる(後続テストで保証)
  - _Requirements: 3.1, 3.2, 3.3_
  - _Boundary: lib/ai/schema_

- [ ] 2.2 (P) Prompt Builder と Few-shot 静的埋込
  - `lib/ai/prompt.ts` を新規作成、`buildAnalysisPrompt(input): { systemPrompt, userParts }` を実装(純関数)
  - system prompt に固定文(役割定義 + 出力規約 + 確信度判断基準 90-100/70-89/50-69/0-49)+ Few-shot 2 例(導楽 + 蕎楽亭、Issue #13 本文の架電スクリプトをそのまま埋込)
  - user message Parts: フォーム値 JSON、HTML 全文(空時は省略)、自由追加指示(空時は省略)を別 Part として並べる
  - `assignedSales` 空時は `"ファーストWEBの担当者"` を neutral placeholder として system prompt に差し込む
  - 自由追加指示は user message の独立 Part に配置(構造化出力契約を上書きできない位置)
  - 同一入力で deterministic な systemPrompt + userParts を返す
  - _Requirements: 2.4, 3.4, 7.1, 7.2_
  - _Boundary: lib/ai/prompt_
  - _Depends: 2.1_

- [ ] 2.3 (P) Validator(Zod 二重検証)
  - `lib/ai/validate.ts` を新規作成、`validateAiAnalysis(raw: unknown): Result<AiAnalysisResult, AiValidationError>` を実装
  - 内部で `AiAnalysisSchema.safeParse(raw)` を呼び、失敗時は Zod issues を簡素化した `zodIssues: string[]` で `{ ok: false, error: { kind: "schema_violation", zodIssues } }` を返す
  - 成功時は型安全な `AiAnalysisResult` を返す
  - フィールド欠落・確信度範囲外(-1, 101, 73.5)・`call_script` 1501 字・追加プロパティのいずれの異常入力でも `ok: false` を返す
  - _Requirements: 3.5, 7.3_
  - _Boundary: lib/ai/validate_
  - _Depends: 2.1_

- [ ] 2.4 (P) Rate Limiter
  - `lib/ai/rate-limiter.ts` を新規作成、プロセス内 `Map<string, number[]>` ベースで per-store(同一 storeId 10 分以内 5 回) + global(60 秒以内 10 回)を実装
  - `checkRateLimit(storeId: string | null): RateLimitResult` を export、cleanup を呼出時に実施(別スレッド不要)
  - `storeId === null` の場合は per-store 判定をスキップし global のみチェック
  - test only: `_resetRateLimitForTest(): void` を export(production では呼ばない契約をコメントで明記)
  - 6 回連続呼出で 6 回目に `{ ok: false, reason: "per_store" }` が返る、storeId null では per-store 判定がスキップされる
  - _Requirements: 6.3_
  - _Boundary: lib/ai/rate-limiter_

- [ ] 2.5 (P) Gemini Client(`@google/genai` ラッパ)
  - `lib/ai/client.ts` を新規作成、冒頭に `import 'server-only'` を必ず付与
  - `createGeminiClient(): GeminiClient` で `@google/genai` の `GoogleGenAI` を初期化、`process.env.GEMINI_MODEL ?? "gemini-2.5-flash"` をモデルとして使う
  - `generateAnalysis(input: AnalysisInput, signal: AbortSignal): Promise<unknown>` を実装、`config` に `responseMimeType: "application/json"`, `responseJsonSchema: input.jsonSchema`, `tools: [{ urlContext: {} }]`, `abortSignal: signal` を渡す
  - SDK エラーを `AiClientError` discriminated union(`missing_api_key` / `timeout` / `rate_limit` / `auth_error` / `api_error` / `network_error` / `unknown`)に正規化し、API キー値や request ID を含めない
  - `isApiKeyConfigured()` を re-export(`lib/env.ts` 由来)
  - 単独で `tsc --noEmit` を通過し、`createGeminiClient()` が型エラーなく構築できる(実 API 呼出は 6.3 / 7.2 で確認)
  - _Requirements: 2.4, 2.6, 2.7, 6.1_
  - _Boundary: lib/ai/client_
  - _Depends: 1.2, 2.1_

---

- [ ] 3. URL Parser limited extension: HTML retention and operator extraction

- [ ] 3.1 (P) OgpResult への HTML 保持と運営者抽出セレクタ追加
  - `lib/url-parser/types.ts` の `OgpResult` に `html?: string` と `operator?: { value: string; source: "tabelog_dom" | "json_ld" }` を追加、`ApplyResult` に `operator_type: OperatorType`, `operator_name: string` を追加、`ApplyConfidence` に `operator_name` キーを追加
  - `lib/url-parser/ogp.ts` の `extractFromHtml` で食べログ「店舗情報」テーブルの「運営者」行(cheerio セレクタ)と JSON-LD `Restaurant.parentOrganization.name` から `operator` を抽出(取れた方を採用、両方取れたら JSON-LD 優先)
  - cheerio で `<script>`, `<style>`, `<svg>` を除去後の `$.html()` を `OgpResult.html` に保存(payload 30〜40% 削減)
  - 既存の OgpResult フィールド(name / address / phone / rating 等)抽出ロジックは不変
  - 食べログ実 URL を `fetchOgp(url)` で取得すると `OgpResult.html` に整形済 HTML が含まれ、運営者付きページでは `OgpResult.operator` に値が入る
  - _Requirements: 1.3_
  - _Boundary: lib/url-parser/ogp, lib/url-parser/types_
  - _Depends: 1.3_

- [ ] 3.2 applyParsedData の operator マージと信頼度同時セット
  - `lib/url-parser/apply.ts` の `applyParsedData` で `OgpResult.operator` が取れた場合、`ApplyResult.operator_name` に value を反映、`ApplyResult.operator_type` は `"未設定"` を維持(法人 / 個人判別は LLM または手動)
  - `ApplyConfidence.operator_name` を source に応じて 85(`tabelog_dom`)または 90(`json_ld`)で同時セット
  - 食べログ運営者付き URL を `importFromUrlAction` で読込むと、`UrlImportResult.suggested.operator_name` に値、`confidence.operator_name` に 85 / 90 が入る
  - _Requirements: 1.3_
  - _Boundary: lib/url-parser/apply_

---

- [ ] 4. Server Actions: AI analysis and store-actions extension

- [ ] 4.1 analyzeStoreAction Server Action 実装
  - `lib/actions/ai-analysis-actions.ts` を新規作成、`"use server"` + `import 'server-only'` を冒頭付与
  - `analyzeStoreAction(formData: FormData): Promise<ActionResult<AiAnalysisResult>>` を実装
  - 順序: ① name non-empty チェック → ② `checkRateLimit(storeId)` → ③ `buildAnalysisPrompt({ formValues, htmlContent, additionalInstructions, assignedSales })` → ④ `createGeminiClient().generateAnalysis(input, AbortSignal.timeout(60_000))` → ⑤ `validateAiAnalysis(raw)`
  - 各失敗パス(空 name / rate limit / timeout / API error / validation error)を `ActionResult.failure(userMessage)` に正規化済メッセージで吸収、フォーム値や DB 状態は不変
  - 成功時は `ActionResult.success(AiAnalysisResult)` を返す
  - 環境で `GEMINI_API_KEY` 設定済の場合に FormData 入力を受けて呼出すと `ActionResult.success` または `ActionResult.failure` のいずれかを返す
  - _Requirements: 2.3, 2.4, 2.6, 3.4, 3.5, 6.1, 6.3, 7.1, 7.2, 7.3_
  - _Boundary: lib/actions/ai-analysis-actions_
  - _Depends: 2.2, 2.3, 2.4, 2.5_

- [ ] 4.2 createStoreAction の operator + AI 結果対応拡張
  - `lib/actions/store-actions.ts` の `buildStoreInput` を拡張、FormData から `operator_type`(`asOperatorType` 型ガード経由)、`operator_name`、`ai_analysis_result`(JSON 文字列を `JSON.parse` 後 `validateAiAnalysis` で再検証、空文字なら null)を読出し
  - `asOperatorType(raw): OperatorType` 型ガード関数を新規追加(既存 `asContactForm` / `asChannel` / `asPriority` パターンに合わせる、不正値は `"未設定"` にフォールバック)
  - `updateStoreAction` も同じ `buildStoreInput` 経由のため自動追従
  - 保存後の `revalidateTag(CACHE_TAGS.store(id))` は既存呼出を維持
  - 店舗登録フォームから operator + ai_analysis_result を含む FormData を submit すると、Mock / DB の両方で 3 フィールドが永続化される
  - _Requirements: 1.5, 1.6, 5.1_
  - _Boundary: lib/actions/store-actions_
  - _Depends: 1.3, 2.3_

---

- [ ] 5. UI Layer: hooks, badge, AI panel, form integration, list/detail

- [ ] 5.1 (P) useBeforeUnload hook
  - `lib/hooks/use-before-unload.ts` を新規作成、`"use client"` 冒頭付与
  - `useBeforeUnload(enabled: boolean): void` を実装、`useEffect` 内で `enabled === true` のときのみ `window.addEventListener("beforeunload", handler)` を登録、cleanup で removeEventListener
  - `handler` は `e.preventDefault(); e.returnValue = ""` のみ(モダンブラウザは独自メッセージ非対応)
  - 任意の Client Component で `useBeforeUnload(true)` を呼び、ブラウザでタブ閉じ操作を行うと標準確認ダイアログが表示される
  - _Requirements: 6.4_
  - _Boundary: lib/hooks/use-before-unload_

- [ ] 5.2 (P) IndividualStoreBadge コンポーネント
  - `components/feature/individual-store-badge.tsx` を新規作成、`OperatorType` を受け取り `"個人店"` のときのみ Badge 表示、それ以外は null を返す
  - 既存の Badge プリミティブ(または Stage / Channel / Priority バッジパターン)に合わせて実装
  - 3 種の `operatorType` 値で render すると、`"個人店"` のみバッジが表示され、他の 2 値では描画されない
  - _Requirements: 1.4_
  - _Boundary: components/feature/individual-store-badge_
  - _Depends: 1.3_

- [ ] 5.3 AiAnalysisPanel: CTA + 自由追加指示 + Server Action 連携
  - `app/(main)/stores/new/_components/ai-analysis-panel.tsx` を新規作成、`"use client"` 冒頭付与
  - props: `getFormSnapshot`, `initialResult`, `onResult`, `onFieldEdit`, `isApiKeyConfigured`, `currentResult`, `confidence`, `onResultFieldChange`, `storeId`
  - 上部に CTA `<Button variant="primary">[AI で分析]</Button>` + 自由追加指示 `<Textarea maxLength={500}>` を配置
  - `useTransition` で `analyzeStoreAction` を呼び、pending 中は CTA disabled、成功時は `onResult(result)` 呼出、失敗時は `toast.error(message)` 表示
  - `isApiKeyConfigured === false` のとき CTA を disabled + tooltip(「環境変数 GEMINI_API_KEY が未設定です」相当)
  - **コスト/トークン数の UI 表示は組み込まない**(Req 6.5)
  - 自由追加指示の入力値は再実行間で保持(`useState` ベースで onChange / unmount で消えない)
  - 結果表示は本タスクでは省略(5.4 で実装)、ボタン押下成功で `onResult` callback 経由で親に通知される
  - `/stores/new` を開くと CTA + 追加指示欄が表示され、ボタン押下で AI 分析が実行されて Server Action が結果を返す(結果の表示・編集は 5.4 で完成)
  - _Requirements: 2.1, 2.2, 2.5, 2.7, 2.8, 6.1, 6.2, 6.5_
  - _Boundary: app/stores/new/ai-analysis-panel_
  - _Depends: 2.1, 4.1_

- [ ] 5.4 AiAnalysisPanel: 結果表示 5 エリア + 背景色 + 警告 + 編集 + コピー
  - 同 `ai-analysis-panel.tsx` に 5 エリア(Markdown 2 個 + プレーンテキスト 3 個)を Card 内に追加レンダリング、各エリアは `<Textarea>` で編集可
  - 各エリアに `confidenceToBg(confidence[key])` で背景色適用(`lib/url-parser/confidence-color` から流用)
  - `confidence < 50` のとき "⚠ 要確認" インジケータをエリア横に表示
  - 各 `<Textarea>` の onChange は親の `onResultFieldChange(field, value)` + `onFieldEdit(field)` を呼び、親側で confidence の該当キーを delete(編集マーカー = 背景色解除)
  - 架電スクリプトエリアに「クリップボードへコピー」ボタンを配置(既存 `CopyButton` パターンを流用)、押下で `navigator.clipboard.writeText` + `toast.success` 表示
  - 再実行時は `setAiResult(newResult)` で 5 エリア全フィールド + confidence を完全上書き(履歴保持なし)
  - `initialResult` が `null` の場合はエリア群を空状態にする(Req 5.3)
  - 編集モードで `initialResult` が渡されたとき、5 エリアと confidence 背景色が初期化時に復元される
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.2, 5.3, 5.4_
  - _Boundary: app/stores/new/ai-analysis-panel_
  - _Depends: 5.3_

- [ ] 5.5 StoreNewForm 統合(operator UI + AiAnalysisPanel embed + useBeforeUnload + applyImport 拡張)
  - `app/(main)/stores/new/_components/store-new-form.tsx` の `FormState` を拡張、`operator_type`, `operator_name`, `additionalInstructions`, `htmlContent: string | null`, `aiResult: AiAnalysisResult | null` を追加、既存 `confidence` state を `ApplyConfidence & Partial<AiAnalysisConfidence>` に拡張
  - 「基本情報」セクションに operator セレクタ(`<Select>`)+ operator_name テキスト入力(`<Input>`)を追加、background style は既存 `bgStyle("operator_name")` を流用
  - 「営業メモ」セクション直下に `<AiAnalysisPanel>` を embed、callback で `aiResult` / `confidence` を親 state に統合
  - `applyImport` 関数を拡張、URL 由来の `operator_name` を反映、`OgpResult.html` を `htmlContent` state に保持
  - `useBeforeUnload(isDirty)` を呼ぶ、`isDirty = aiResult !== null && !persisted`
  - `<form action={submit}>` の submit FormData に `operator_type`, `operator_name`, `ai_analysis_result`(JSON.stringify), `htmlContent`, `additionalInstructions` を含める
  - `/stores/new` で URL を読込→ operator が表示 → [AI で分析] で 5 エリア表示 → 編集で背景色解除 → [保存] で全フィールド(operator + AI 5 + confidence)が DB に保存される
  - _Requirements: 1.1, 1.2, 1.3, 4.4, 5.4, 6.4_
  - _Boundary: app/stores/new/store-new-form_
  - _Depends: 3.1, 4.2, 5.1, 5.2, 5.4_

- [ ] 5.6 店舗詳細・一覧での個人店バッジ表示と AI 結果復元
  - `app/(main)/stores/[id]/page.tsx` および店舗詳細表示コンポーネントで `<IndividualStoreBadge operatorType={store.operator_type}>` を組込、店舗名横に表示
  - 店舗一覧 `app/(main)/stores/page.tsx`(または該当 list component)でも同様にバッジ表示
  - 編集モード(または詳細表示)で `<AiAnalysisPanel initialResult={store.ai_analysis_result}>` を経由して過去の AI 分析結果と confidence を復元、`null` のとき空状態を維持
  - 個人店として登録した店舗を一覧 / 詳細で開くとバッジ表示され、過去に分析した店舗の編集画面では 5 エリアが confidence 背景色付きで復元される
  - _Requirements: 1.4, 5.2, 5.3_
  - _Boundary: app/stores/[id], app/stores/list_
  - _Depends: 4.2, 5.2, 5.5_

---

- [ ] 6. Tests

- [ ] 6.1 (P) AI Service Layer 単体テスト
  - `lib/ai/__tests__/schema.test.ts`: `AiAnalysisSchema.safeParse` で正常入力成功、必須フィールド欠落 / confidence 範囲外 / call_script 1501 字 / 追加プロパティで失敗、`getAiAnalysisJsonSchema()` の `propertyOrdering` 順序検証
  - `lib/ai/__tests__/validate.test.ts`: 5 フィールド欠落、confidence -1 / 101 / 73.5、call_script 1501 字、追加プロパティ全パターンで `{ ok: false, error.zodIssues }`、正常入力で `{ ok: true, value }`
  - `lib/ai/__tests__/rate-limiter.test.ts`: per-store 5 回 OK / 6 回目 reject、`vi.useFakeTimers()` で 10 分後にクリア確認、global 10 回 OK / 11 回目 reject、storeId null での per-store スキップ、`_resetRateLimitForTest` の動作
  - `lib/ai/__tests__/prompt.test.ts`: assigned_sales 空時 placeholder 差し込み、additional_instructions 空 / 非空、Few-shot 2 例(導楽 + 蕎楽亭)が systemPrompt に含まれる、HTML 空時の Part 省略
  - `pnpm test lib/ai` で全テストが PASS する
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 6.3, 7.1, 7.2_
  - _Boundary: lib/ai/__tests___
  - _Depends: 2.1, 2.2, 2.3, 2.4_

- [ ] 6.2 (P) URL Parser 拡張テスト
  - `lib/url-parser/__tests__/ogp.test.ts` を拡張、食べログ運営者付き fixture HTML を `__fixtures__/` に追加、`fetchOgp` または `extractFromHtml` 経由で `OgpResult.operator` の value と source、`OgpResult.html` のサイズ削減(script/style/svg 除去後)を検証
  - `lib/url-parser/__tests__/apply.test.ts` を拡張、`applyParsedData` で `operator_name` の信頼度 85(cheerio) / 90(JSON-LD)が `confidence.operator_name` に正しく入ることを検証、`operator_type` は "未設定" を維持
  - 既存テストにリグレッションがないことも確認(name 抽出、connie 連鎖等)
  - `pnpm test lib/url-parser` で既存 + 新規テストすべて PASS
  - _Requirements: 1.3_
  - _Boundary: lib/url-parser/__tests___
  - _Depends: 3.1, 3.2_

- [ ] 6.3 (P) Server Action 統合テスト(Gemini SDK モック)
  - `lib/actions/__tests__/ai-analysis-actions.test.ts` を新規作成、`vi.mock("@google/genai", ...)` で SDK インターセプト
  - 各経路を網羅: ① 正常成功(`ActionResult.success`)、② 空 name(`failure` + 早期 return)、③ rate limit(rate limiter の状態を直接操作 or 連続呼出 + `_resetRateLimitForTest` 後再検証)、④ timeout(SDK モックが promise を resolve しない、`AbortController` 動作)、⑤ API error 4xx / 5xx、⑥ 不正な JSON、⑦ schema 違反
  - 全経路で `ActionResult` のフォーマットと正規化済メッセージが期待通りであることを検証、実 API は叩かない
  - `pnpm test lib/actions/__tests__/ai-analysis-actions.test.ts` で全経路が PASS
  - _Requirements: 2.3, 2.6, 3.5, 6.1, 6.3_
  - _Boundary: lib/actions/__tests___
  - _Depends: 4.1_

---

- [ ] 7. Final verification

- [ ] 7.1 静的検証(typecheck / lint / build / test)
  - `pnpm typecheck && pnpm lint && pnpm build && pnpm test` の 4 コマンドが exit 0 で終了
  - Mock mode (`USE_MOCK_DB=true`) と DB mode 両環境で `pnpm build` 成功
  - クライアントバンドルに `@google/genai` / `zod` / `zod-to-json-schema` が含まれていない(`server-only` 隔離が機能している)ことを `pnpm build` の出力で確認
  - 4 コマンド PASS の状態
  - _Requirements: 1.5, 1.6, 5.1_
  - _Depends: 5.5, 5.6, 6.1, 6.2, 6.3_

- [ ]* 7.2 PoC: 食べログ実 URL × Gemini Flash で実コスト・レイテンシ計測
  - `.env.local` に `GEMINI_API_KEY` を設定、`pnpm dev` 起動
  - 食べログ実 URL 1 件(導楽 / 蕎楽亭等)を `/stores/new` で読込 → [AI で分析] 押下、計測ストップウォッチ
  - レイテンシ < 30 秒、Gemini billing dashboard で 1 回コスト < $0.05 を確認、出力品質(架電スクリプト・強み弱みの妥当性)を目視評価
  - 計測値を `research.md` の Open Questions 表(行 #1)に追記
  - 実コスト・レイテンシ・品質評価が research.md に追記された状態。実 API 呼出を伴うため optional 扱い、本番運用前に 1 回は必須
  - _Requirements: 2.4, 2.5, 2.6, 3.1, 3.4, 4.1, 4.2_
  - _Depends: 7.1_

- [ ] 7.3 手動 E2E チェックリスト
  - **Golden path**: URL 読込 → operator 自動充足 → [AI で分析] → 5 エリア表示 → 部分編集で背景色解除 → [保存] → 詳細画面で復元
  - **エッジ 1**: API キー未設定 → ボタン disabled + tooltip 表示
  - **エッジ 2**: タイムアウト(モック or ネットワーク遅延)→ toast 表示 + ボタン即時再有効化
  - **エッジ 3**: 同一 storeId で 6 回連続 [AI で分析] → 6 回目に rate limit toast
  - **エッジ 4**: 自由追加指示 500 字超 → maxLength 属性で阻止
  - **エッジ 5**: AI 結果生成後 [保存] せずタブ閉じ → 確認ダイアログ
  - **個人店バッジ**: operator_type に "個人店" を選択した店舗が一覧と詳細でバッジ表示
  - 上記すべての項目をブラウザで手動確認、不具合があればチケット起票(本タスクは検出のみ、修正は別タスク)
  - チェックリストに OK/NG が全項目記録された状態
  - _Requirements: 1.4, 2.6, 2.7, 4.4, 5.2, 6.3, 6.4, 7.1_
  - _Depends: 7.1_

---

## Implementation Notes

(タスク実行中に得られた cross-cutting 知見をここに追記する。各エントリは 1 行で、後続タスクが参照する想定)

- **Phase 1 完了時の TS エラー連鎖** (1.3 後 / commit `feat(ai-store-analysis): Phase 1 ...` 時点): `lib/actions/store-actions.ts:53`(`buildStoreInput` が新 3 フィールド欠落)、`lib/db/store-repository.ts:101,118`(DB layer で `ai_analysis_result: AiAnalysisResult | null` を text 列に渡せない)、`lib/actions/data-actions.ts:217`、`scripts/seed.ts:44,47`(Repository 経由のシリアライズ責務未対応)。これらは設計書 File Structure Plan の Modified Files に明示されていなかったが、**Task 4.2 のスコープに「`lib/db/store-repository.ts` と `scripts/seed.ts` の JSON.stringify/parse 変換経路追加」を含めて解消する**(`lib/actions/data-actions.ts` も同種の修正が連鎖、Task 4.2 で touch)。
- **drizzle migration の自動生成**(1.4): `DATABASE_URL="" pnpm drizzle-kit generate --name=add_operator_and_ai_analysis` で `drizzle/0001_*.sql` + `meta/_journal.json` + `meta/0001_snapshot.json` が自動生成される(DB 接続不要)。今後の schema 変更時もこの方式が標準。
- **`@google/genai` のビルドスクリプト警告**(1.1): `pnpm install` 時に「Ignored build scripts」警告が出るが、Vercel デプロイでは既定で問題なし。ローカルで native binding を使う場合のみ `pnpm approve-builds` を検討。
