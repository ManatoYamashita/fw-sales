# Requirements Document

## Project Description (Input)

参照元: GitHub Issue #13 — `feat(stores/new): [AI で分析] ボタンで強み・弱み・架電スクリプト・GBP 分析を補完`
URL: https://github.com/ManatoYamashita/fw-sales/issues/13

### 誰が課題を抱えているか

フリーストWEB の営業担当(飲食店向け WEB 集客 sales tool `/stores/new` のユーザー)。

### 現状

- `/stores/new` の URL 自動入力(cheerio + JSON-LD + 食べログ → 公式 HP の連鎖補完)で、12 項目中 9〜11 項目は自動充足済(店舗名・住所・電話・口コミ件数・評価・公式 URL 等)。
- 一方で営業判断に直結する分析項目(強み / 弱み / 架電スクリプト / GBP 充実度 / グルメサイト課金状況 / 運営者)は依然として手動。1 店舗あたり 5〜10 分の調査工数が積み上がっている。
- 既に同等品質の架電スクリプトを 2 例(導楽 / 蕎楽亭、Issue #13 内に全文掲載)書いた実績があり、テンプレ化可能。
- 信頼度別の背景色グラデーション UI(`lib/url-parser/confidence-color.ts:confidenceToBg`)は既に他フィールドで稼働中。

### 何を変えるか

1. 店舗マスタに **運営者種別 (`operator_type`: 「個人店」/「複数店舗運営」/「未設定」)** + **運営者名 (`operator_name`)** の 2 フィールドを追加する。これは「個人店のほうが受注成約率が高い」という営業上のシグナルを構造化データとして扱うため。
2. `/stores/new` フォームに **[AI で分析]** CTA ボタンを配置(既存の [保存] と並列、CTA は AI 側)。
3. ボタン押下で、現在のフォーム値に加えて **取得済の HTML 全文** と **公開 URL 参照能力** を持った外部 LLM サービス(Google Gemini を想定。食べログ口コミの取得能力が確認済) に投げ、構造化出力で次を得る:
   - **強み** (Markdown)
   - **弱み** (Markdown)
   - **グルメサイト課金状況** (プレーンテキスト)
   - **GBP (Google ビジネスプロフィール) 充実度** (プレーンテキスト)
   - **架電スクリプト** (プレーンテキスト、上限 1,500 文字、`assigned_sales` を発信者として差し込み)
   - 各フィールドの確信度スコア (0-100)
4. AI 分析結果は **既存 `confidenceToBg` の背景色グラデーション** で確信度を視覚化、`confidence < 50` の項目は警告強調する。
5. ユーザー編集で背景色解除(既存マーカー仕様踏襲)。架電スクリプトには「クリップボードへコピー」ボタンを追加。
6. AI 分析結果は **店舗マスタの JSON 列として DB に永続化** し、再表示時に復元する。再分析時は前回結果を上書き(履歴は保持しない)。
7. **[AI で分析] ボタンの隣に自由記述プロンプト追記欄** を設け、店舗ごとの個別事情(「コスパ不満を重点に」等)を LLM に注入できるようにする。

### 制約・前提

- LLM は Google Gemini を採用(モデル/SDK の具体は設計フェーズで確定)。`@google/generative-ai`(または公式 SDK)を新規 dep として追加し、API キー(例: `GEMINI_API_KEY`)を `.env.example` / `.env.local` で管理する。
- API キー未設定時は [AI で分析] ボタンを disabled + tooltip で説明し、サービス全体は落とさない。
- 1 回あたりのコスト目安はユーザーに表示しない(社内ツール、コスト透明化はスコープ外)。
- AI 出力のキャッシュ・分析履歴・部分再生成・research/deals 画面展開・マルチモデル選択 UI・分析監査ログ・ストリーミング表示・`operator_type` を活用した一覧フィルタ/並び替え/優先度自動判定 は **本 spec のスコープ外**(別 Issue で扱う)。
- Issue 原文の "GDP" は文脈から **GBP (Google Business Profile)** の誤記と判断し、本 spec では GBP 表記で統一。

## Introduction

`/stores/new` (店舗登録) フォームに、外部の汎用 LLM サービスを呼び出す **[AI で分析]** CTA ボタンを追加する。LLM への入力は、cheerio で取得済の店舗構造化データ + ページ HTML 全文 + LLM 自身の公開 URL 参照能力 + ユーザーが入力した自由追加指示。LLM は構造化出力で **強み (Markdown) / 弱み (Markdown) / グルメサイト課金状況 / GBP 充実度 / 架電スクリプト** の 5 エリアと各確信度 (0-100) を返す。営業担当はそれらを既存の確信度背景色グラデーションで判別しつつ部分編集でき、[保存] でフォーム本体と AI 分析結果が DB に永続化される(再表示時に復元)。

加えて、店舗マスタに **運営者種別 + 運営者名** の 2 フィールドを追加し、個人店判別による営業優先度シグナルとして構造化データに組み込む。

## Boundary Context

### In scope (このフィーチャーが責任を持つ振る舞い)

- 店舗マスタへの `operator_type` (個人店 / 複数店舗運営 / 未設定) + `operator_name` (フリーテキスト) 追加。店舗登録 UI、永続化、復元、個人店バッジ表示。
- `/stores/new` への [AI で分析] CTA ボタン + 自由追加指示入力欄 + 進行中ローディング状態。
- LLM への入力構築(フォーム全値 + 取得済 HTML 全文 + 自由追加指示 + 公開 URL 参照許可)。
- 構造化出力 5 エリア(強み Markdown / 弱み Markdown / グルメサイト課金 / GBP / 架電スクリプト)+ 各確信度 (0-100)。
- 既存 `confidenceToBg` 背景色ヘルパの再利用、低確信度 (< 50) 警告強調、ユーザー編集による背景色解除、架電スクリプトのクリップボードコピー。
- 失敗時 toast + 60 秒タイムアウト + API キー未設定時の disabled + レートリミット保護(同一店舗 10 分以内 5 回以上、または全体 60 秒以内 10 回以上で拒否)。
- AI 分析結果の DB 永続化(JSON 列を想定、設計フェーズで確定)と再表示時の復元。再分析時の上書き。
- 未保存遷移警告(AI 結果を保存せずページ離脱しようとした場合の確認ダイアログ)。
- 架電スクリプトへの `assigned_sales` 動的差し込み。1,500 文字上限。

### Out of scope (本 spec が責任を持たない振る舞い、別 Issue へ)

- AI 出力のキャッシュ(同一 URL に対する再分析の結果再利用)。
- 部分再生成(「強みだけ再生成」「架電スクリプトだけ再生成」)。
- 分析履歴の保持(常に上書き)。
- 分析監査ログ(誰がいつ分析したかの記録)。
- AI レスポンスのストリーミング表示。
- マルチモデル選択 UI(Haiku / Sonnet / Gemini Pro 切替)。
- `/research` / `/deals` 画面への AI 分析機能展開。
- 自動架電 / 自動 DM 送信 / 営業ステージ AI 自動判定。
- `operator_type` を活用した店舗一覧のフィルタ・並び替え・チャネル/優先度の自動判定(本 spec では記録と表示バッジのみ)。
- AI 分析 1 回あたりのコスト/トークン数の UI 表示。

### Adjacent expectations (隣接システム/spec への依存と暗黙期待値)

- 既存の URL 解析 (`lib/url-parser/`) と cheerio 取得 + 食べログ → 公式 HP 連鎖補完は本 spec が前提とし、改修しない。
- 既存の信頼度規則(0-100 スコア + `confidenceToBg` 背景色グラデ)に AI 出力も同じスケールで合流する。
- 既存の `assigned_sales` フィールド(`SALES` 定数: 渡部・佐藤等)を架電スクリプトの発信者名として参照する。
- 既存の Server Action `createStoreAction` を経由した DB 永続化フローを変更しない(`operator_*` と AI 分析結果の追加列を `createStoreAction` の入力に拡張する形は許容)。
- 外部 LLM サービス(Google Gemini)は本サービスの依存外部システムであり、API 障害時は本フォームの保存・編集・他機能は影響を受けない。
- LLM API キーは本 spec で管理し、未設定時は当該機能のみ disabled とする(他機能の動作は不変)。
- 取得済の HTML 全文は URL 解析時に保持しているか、または分析時点で再取得する。本 spec は「分析時にフォームから参照可能」という観測可能な状態を要件化し、保持戦略は設計に委ねる。

---

## Requirements

### Requirement 1: 運営者情報の登録・表示・判別

**Objective:** As a 営業担当, I want 店舗が個人店か法人運営かを構造化データとして登録できる, so that 個人店優先の営業戦略をデータで判断できる.

#### Acceptance Criteria

1. The Store Registration Form shall provide an operator type selector with the values "個人店", "複数店舗運営", and "未設定" (default).
2. The Store Registration Form shall provide a free-text operator name input that holds the company name when the operator type is "複数店舗運営" and the owner name when the operator type is "個人店".
3. When URL parsing extracts an operator candidate from public listings (e.g., 食べログ "店舗情報" or JSON-LD `parentOrganization.name`), the Store Registration Form shall pre-fill the operator name field with the extracted value and apply the existing confidence background color to the field.
4. While the operator type is set to "個人店", the Store Detail Display and the Store List Display shall render a visually distinct individual-store badge alongside the store name.
5. When the user submits the Store Registration Form, the Store Persistence Layer shall persist both `operator_type` and `operator_name` together with the rest of the store record and shall restore them on subsequent reads of the same store.
6. Where the operator type is "未設定" and no operator name is provided, the Store Persistence Layer shall persist the store record without raising a validation error.

### Requirement 2: AI 分析機能の起動・前提条件・入力構築

**Objective:** As a 営業担当, I want 店舗情報を入力した状態で [AI で分析] を押すだけで分析を実行できる, so that 営業判断材料が手間なく揃う.

#### Acceptance Criteria

1. The Store Registration Form shall display an "[AI で分析]" button styled as the primary CTA, placed adjacent to the "[保存]" button.
2. The Store Registration Form shall display a free-text additional-instructions input adjacent to the "[AI で分析]" button, accepting up to 500 characters of user-entered guidance.
3. When the user clicks "[AI で分析]", the Store Analysis Service shall require a non-empty store name and shall reject the request with a user-visible toast if the store name is empty.
4. When "[AI で分析]" is invoked with a non-empty store name, the Store Analysis Service shall send to the external LLM (a) all currently visible form values including the operator fields, the source URL, and the memo, (b) the full HTML content corresponding to the source URL when available to the form, (c) the user-entered additional instructions when non-empty, and (d) instructions permitting the LLM to fetch and reference public URLs (such as the source store URL) during analysis.
5. While the AI analysis is in progress, the Store Registration Form shall disable the "[AI で分析]" button, render a loading indicator, and keep all other form fields editable.
6. If the AI analysis does not complete within 60 seconds from invocation, the Store Analysis Service shall abort the request, leave the form values unchanged, and notify the user via a toast describing the timeout.
7. If the LLM API key is not configured in the environment, the Store Registration Form shall render the "[AI で分析]" button in a disabled state with a tooltip explaining the missing configuration, and the rest of the form shall remain fully functional.
8. When the user clicks "[AI で分析]" repeatedly, the Store Registration Form shall preserve the additional-instructions input value across runs unless the user clears it manually.

### Requirement 3: AI 分析の構造化出力契約

**Objective:** As a 営業担当, I want AI 分析結果が常に同じ 5 つのエリアと各確信度で返ってくる, so that UI 表示と編集が安定的に動作する.

#### Acceptance Criteria

1. The Store Analysis Service shall return a structured result containing exactly five fields: `strengths_markdown` (Markdown text), `weaknesses_markdown` (Markdown text), `gourmet_paid_status` (plain text), `gbp_completeness` (plain text), and `call_script` (plain text).
2. The Store Analysis Service shall attach a confidence score in the range 0–100 to each of the five fields.
3. The Store Analysis Service shall enforce that the `call_script` field contains no more than 1,500 characters.
4. When the form's `assigned_sales` value is non-empty, the Store Analysis Service shall include that name as the caller's self-introduction in the generated `call_script`; when `assigned_sales` is empty, the script shall use a neutral placeholder such as "ファーストWEBの担当者".
5. If the LLM returns a result that is missing any of the five fields, missing any of the five confidence scores, or violates the 1,500-character limit on `call_script`, the Store Analysis Service shall surface an error to the user and shall not partially apply the result to the form.

### Requirement 4: AI 分析結果の表示・編集 UI

**Objective:** As a 営業担当, I want AI 出力の確信度を視覚的に把握しつつ必要箇所だけを手早く修正できる, so that 営業活動の準備時間を削減できる.

#### Acceptance Criteria

1. When AI analysis succeeds, the AI Analysis Display shall render five separate editable areas: a Markdown editor for `strengths_markdown`, a Markdown editor for `weaknesses_markdown`, and three plain-text editors for `gourmet_paid_status`, `gbp_completeness`, and `call_script`.
2. The AI Analysis Display shall apply the existing confidence background-color gradient (the same scale and helper used by the URL import flow) to each of the five editor areas based on the confidence score for that field.
3. While a field's confidence score is below 50, the AI Analysis Display shall additionally render a "⚠ 要確認" warning indicator next to that field.
4. When the user manually edits the content of any of the five fields, the AI Analysis Display shall remove the confidence background color from that specific field and treat the field as user-edited going forward.
5. The AI Analysis Display shall provide a "クリップボードへコピー" action attached to the `call_script` editor that copies the field's current text to the system clipboard and shows a brief success toast.
6. When the user re-runs "[AI で分析]" after a previous successful analysis, the AI Analysis Display shall overwrite all five fields and confidence scores with the new result without retaining the previous result.

### Requirement 5: AI 分析結果の永続化と復元

**Objective:** As a 営業担当, I want 保存した店舗を後で開き直したときに過去の AI 分析結果が復元される, so that 営業判断の継続性を保てる.

#### Acceptance Criteria

1. When the user submits the Store Registration Form via "[保存]", the Store Persistence Layer shall persist the AI analysis result (all five fields and their confidence scores) together with the store record.
2. When a stored store is opened or edited, the AI Analysis Display shall restore the previously persisted analysis result and confidence scores into the five editor areas, with the confidence background colors applied as on initial generation.
3. While no AI analysis has ever been performed for a store, the AI Analysis Display shall remain in an empty state without rendering placeholder editor content.
4. When the user manually edits a restored field after reopening the store, the AI Analysis Display shall apply the same edit-marker behavior as on initial generation (remove the confidence background color for that field).

### Requirement 6: 失敗時の挙動・レートリミット・未保存遷移警告

**Objective:** As a 営業担当, I want 異常時にもコストを無駄にせず安心して再試行・離脱できる, so that 業務が停止しない.

#### Acceptance Criteria

1. If the LLM call fails due to a network error, rate limit response, authentication failure, or any 4xx or 5xx response, the Store Analysis Service shall preserve the current form values unchanged and display a toast describing the failure category.
2. After a failed AI analysis, the Store Registration Form shall re-enable the "[AI で分析]" button immediately to allow retry without page reload.
3. If the user invokes "[AI で分析]" more than 5 times within 10 minutes for the same store, or more than 10 times within 60 seconds across the application, the Store Analysis Service shall reject the request and display a rate-limit toast.
4. While AI analysis results are present in the form and have not yet been persisted, when the user attempts to navigate away from the Store Registration Form, the Store Registration Form shall display a confirmation dialog warning of unsaved analysis.
5. The Store Analysis Service shall not display token counts, per-call cost figures, or other billing details to the user.

### Requirement 7: 自由追加指示プロンプトの取り扱い

**Objective:** As a 営業担当, I want 店舗ごとの個別事情(「コスパ不満を重点に」「○○エリア向けに調整」等)を AI に伝えたい, so that 分析結果を案件特性に合わせて調整できる.

#### Acceptance Criteria

1. When the additional-instructions input is non-empty at the moment of "[AI で分析]" invocation, the Store Analysis Service shall include the user's instructions as additional guidance in the LLM prompt, in a position that does not override the structured-output contract or the 1,500-character limit on `call_script`.
2. While the additional-instructions input is empty, the Store Analysis Service shall execute analysis using the default system prompt only and shall not fail due to absence of additional instructions.
3. If the user-entered instructions would cause the LLM to deviate from the structured-output contract defined in Requirement 3, the Store Analysis Service shall still enforce the structured-output contract and shall reject any LLM result that violates it.
