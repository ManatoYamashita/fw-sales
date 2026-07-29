# Gemini モデル移行 Runbook (gemini-2.5-flash → gemini-3.6-flash)

営業資産生成 (`generateSalesAssetsAction`) が使う Gemini モデルの移行手順・検証手順・切り戻し手順。

---

## 1. 移行理由と期限

| 項目 | 内容 |
|---|---|
| 旧既定モデル | `gemini-2.5-flash` |
| 状態 | **deprecated** |
| **シャットダウン日** | **2026-10-16** |
| 新既定モデル | **`gemini-3.6-flash`** (GA。Google 公式の推奨後継) |
| 影響範囲 | 放置すると `/research/[storeId]` の営業資産生成と店舗詳細の「営業資産を再生成」が**本番で停止する** |

Gemini 2.5 系は `gemini-2.5-flash` / `gemini-2.5-flash-lite` / `gemini-2.5-pro` がいずれも同日シャットダウン。

出典: [Gemini API — Deprecations](https://ai.google.dev/gemini-api/docs/deprecations) / [Models](https://ai.google.dev/gemini-api/docs/models)

---

## 2. 本移行で変えたもの / 変えていないもの

### 変えたもの (確定変更)

| 対象 | 変更 | 理由 |
|---|---|---|
| `lib/env.ts` `getGeminiModel()` | 既定値 `gemini-2.5-flash` → **`gemini-3.6-flash`** | シャットダウン回避 |
| `lib/ai/client.ts` の `config` | **`temperature: 0.4` を削除** | Gemini 3 系で `temperature` / `topP` / `topK` は deprecated。公式は「既定値から変えるな。下げると loop や性能劣化を起こしうる」 |
| `lib/ai/client.ts` 冒頭 JSDoc | 「構造化出力と tools は同時設定不可 (400)」を訂正 | Gemini 2.5 時代の事実。**Gemini 3 系では併用可能** |
| `AiClientError` | **`max_tokens` を追加** | 長さ切断を「応答が空でした」と区別する。構造化フィールド `candidates[0].finishReason` から判定するため SDK の文面に依存しない |
| `lib/ai/client.ts` | `JSON.parse` を専用経路 (`parseJsonResponse`) へ分離 | SyntaxError のメッセージに含まれるパース位置 (例: `at position 466`) が、SDK エラー用のステータス抽出ヒューリスティック `\b[45]\d\d\b` に拾われ **`api_error(466)` に誤分類される**のを防ぐ。併せて応答本文を上位へ渡さない |
| `lib/ai/client.ts` | エラー分類で**構造化ステータス (`err.status`) を最優先**にし、メッセージ文字列判定はフォールバックへ降格 | `models/xxx is NOT_FOUND for API version v1beta` のように**数字を含まない文面**だと、従来はステータスを失って `unknown`（UI 上「AI 生成でエラーが発生しました」）に落ちていた。SDK クラスへの `instanceof` 依存を避けるため `status` の duck typing で読み、400-599 のみ採用する |
| `isAiClientError` | `lib/ai/client.ts` から export し、action 側の複製を削除 | kind 追加時に片方だけ更新され、新 kind が「不明なエラー」に落ちる事故を防ぐ。判定表を `Record<AiClientError["kind"], true>` にして**追加漏れをコンパイルエラーにした** |
| `.env.example` / `README.md` | 既定モデル表記を更新 | |

### 検討したが見送ったもの

**`model_not_found` 専用エラー分類**: モデル ID の誤設定 (404 / NOT_FOUND) を専用 kind にすることを検討したが、**「404 = モデル不存在」と断定できる構造化シグナルを SDK の型定義から確認できなかった**ため見送った (実 API を叩かずに安全な判定条件を確定できない)。HTTP メッセージ文字列への過度な依存は避ける。

404 は従来どおり `api_error(404)` として扱い、UI にステータスコードを表示する。**モデル移行直後に 404 が出た場合は、まず `GEMINI_MODEL` の値を疑うこと** (§4)。

`topP` / `topK` / `top_p` / `top_k` はリポジトリ全体を検索したが**元から未設定**だった (`temperature` のみ 1 箇所)。

### 変えていないもの (意図的に据置)

`generateContent` / `responseMimeType: "application/json"` / `responseJsonSchema` / system instruction / user parts / `AbortSignal` / `JSON.parse` / Zod 再検証 (`validateAiAnalysis`) / `AiAnalysisResult` の契約 / 手動貼付フロー / `generateSalesAssetsAction` の入出力 / stage 更新 / rate limiter / cache invalidation。

---

## 3. 実測して決める項目 (**未確定**)

以下は**実 Gemini API を叩かないと適切な値を決められない**ため、現在値のまま据え置いている。
**推測で変更しないこと。** §5 の手順で測ってから判断する。

| 対象 | 現在値 | 定義場所 | なぜ未確定か |
|---|---|---|---|
| `thinkingConfig.thinkingLevel` | **未設定** (Gemini の既定に委ねる) | — | Gemini 3 Flash 系の既定は `high` (dynamic) 相当とされる。レイテンシと品質が許容範囲なら**設定を足さないのが最善** |
| `maxOutputTokens` | **4096** | `lib/ai/client.ts` の `MAX_OUTPUT_TOKENS` | Gemini 3 系は thinking トークンも出力枠を消費するため不足しうる。ただし実際に切断が起きるかは測らないと分からない |
| `TIMEOUT_MS` | **60,000ms** | `lib/actions/sales-assets-actions.ts` | ①実 API レイテンシ ②**Vercel Function の実際の実行時間上限**の両方が未確認。**上限を確認するまで引き上げない** |
| retry 回数 | **0 (リトライしない)** | — | 現行どおり。自動リトライは重複課金に直結するため安易に足さない |

### env を増やすかどうかの判断基準

上記を env 化 (`GEMINI_THINKING_LEVEL` / `GEMINI_MAX_OUTPUT_TOKENS` 等) するかは、実測後に決める。

env を 1 つ増やすと、Production / Preview / Development の 3 環境管理、`.env.example` と本 runbook の同期、未設定時の挙動テストが恒久的に付いてくる。
**「実測で 1 度も既定値を変えたくなる場面が無かった項目は env 化しない」**を基準とする。

---

## 4. 環境変数の確認 (**移行前に必ず実施**)

> ### ⚠ コードの既定値を変えても、env で明示設定された環境は移行されない
>
> `getGeminiModel()` は `readEnv("GEMINI_MODEL", "gemini-3.6-flash")` である。
> **`GEMINI_MODEL` が明示設定されている環境では、env の値が優先されるため、コードの既定値変更は一切効かない。**
>
> 実際に、**このリポジトリのローカル `.env.local` には `GEMINI_MODEL=gemini-2.5-flash` が明示設定されている**(2026-07-29 確認)。
> Vercel 側にも同様に設定されている可能性が高い。**必ず 3 環境すべてを目視確認すること。**

### 確認手順 (Vercel Dashboard)

1. [Vercel Dashboard](https://vercel.com/) → team `shinsotsu-gourmet` → project `fw-sales`
2. **Settings → Environment Variables**
3. 次を確認する。

| 変数 | Production | Preview | Development | 対応 |
|---|---|---|---|---|
| `GEMINI_MODEL` | ? | ? | ? | **値が `gemini-2.5-flash` なら `gemini-3.6-flash` に更新するか、変数自体を削除してコード既定に委ねる** |
| `GEMINI_API_KEY` | 必須 | 必須 | 必須 | 存在確認のみ。**値は表示・記録・共有しない** |

`GEMINI_API_KEY` は `scripts/check-required-env.mjs` の必須リストに含まれるため、欠けていると build 時に落ちる。

### 確認手順 (ローカル)

```powershell
# 値ではなくキー名だけを見る
Get-Content .env.local | Where-Object { $_ -match '^GEMINI_' }
```

`GEMINI_MODEL=gemini-2.5-flash` が残っていれば `gemini-3.6-flash` に書き換えるか、行ごと削除する。

### Vercel CLI について

本リポジトリには `.vercel/` (project link) が無く、`vercel` CLI も未インストール (2026-07-29 確認)。
CLI から env を確認したい場合は `npm i -g vercel` → `vercel login` → `vercel link` → `vercel env ls` が必要だが、
**Dashboard での目視確認で足りるため、CLI の導入は必須ではない**。

---

## 5. Preview 検証手順

> **実 API 検証は人間が明示的に実施すること。**
>
> - **実行するたびに Gemini API の課金が発生する。** 5-A + 5-B は最大で 3 店舗 × (旧 1 回 + 新 3 回) = 12 回の生成になる。
> - 自動化やエージェントに任せず、**誰が・いつ・何件叩いたか**を把握できる形で行う。
> - 検証中に取得した値・ログ・スクリーンショットに **`GEMINI_API_KEY` の値を含めない**。
>   記録するのは finishReason / token 数 / レイテンシ / 出力テキストのみ。
> - 店舗の完全住所や個人情報を PR コメント等の公開場所に貼らない。

### 5-A. 旧モデルとの出力比較

1. **既存の代表店舗 3 件**を選ぶ。
   - 基本情報が厚い店舗 / 薄い店舗 / 貼付テキストありで生成する店舗
2. Preview の `GEMINI_MODEL` を一時的に `gemini-2.5-flash` にして生成 → 出力をテキスト保存。
3. `gemini-3.6-flash` に戻して同じ 3 件を再生成 → 比較。

**比較観点**

- [ ] JSON が Zod (`validateAiAnalysis`) を通る
- [ ] `call_script` が 1500 字以内
- [ ] `call_script` の冒頭が「私ファーストWEBの{担当者}と申しまして」で始まる
- [ ] `strengths_markdown` / `weaknesses_markdown` が 300〜600 字
- [ ] `gourmet_paid_status` / `gbp_completeness` に Markdown が混ざっていない
- [ ] `confidence` が 0-100 の整数 5 項目そろっている

### 5-B. 設定値を決めるための実測 (§3 の入力)

各店舗につき **3 回ずつ**実行し、次を記録する。

| 測定項目 | 取得方法 | 判断基準 |
|---|---|---|
| `finishReason` | レスポンスの `candidates[0].finishReason`。**`MAX_TOKENS` なら UI に「長さ上限に達し、途中で切断されました」が出る**ので、UI からも判別できる | **1 度でも `MAX_TOKENS` が出たら `MAX_OUTPUT_TOKENS` を引き上げる**。全て正常なら 4096 のまま |
| 出力トークン数 / thought トークン数 | `response.usageMetadata` (`candidatesTokenCount` / `thoughtsTokenCount`) を一時ログ。**住所・本文は出さない** | 4096 に対する余裕率。余裕が 2 倍未満なら引き上げを検討 |
| レイテンシ (3 回の最大値) | 生成ボタン押下から結果表示まで | **60,000ms に対する余裕**。薄い / 超過するなら timeout 引き上げを検討 → ただし **§6 の Vercel 上限確認が先** |
| 品質 | 5-A の観点 | 2.5 系と同等以上 |

**手順の順序が重要**

1. **まず `thinkingLevel` を設定しない状態で測る。** レイテンシと品質が許容範囲なら**何も足さない**。
2. 許容外だった場合のみ `thinkingConfig: { thinkingLevel: "low" }` を追加して再測定し、改善を確認してから採用する。
3. `MAX_OUTPUT_TOKENS` / `TIMEOUT_MS` も同様に、**測定で問題が出た項目だけ**変更する。
4. 変更した項目について、コード定数で足りるか env が要るかを §3 の基準で判断する。

**測定結果は数値のまま PR 説明と本 runbook に残すこと。** 「問題なかった」だけでは次の人が再判断できない。

### 5-C. エラー経路の確認

- `MAX_OUTPUT_TOKENS` を一時的に極小値 (例: 512) にして生成 → 「AI 生成の応答が長さ上限に達し、途中で切断されました」が UI に出る
- `GEMINI_MODEL=gemini-does-not-exist` を一時設定 → **「AI 生成 API がエラー (404) を返しました」** が出る → **元に戻す**
  - 404 は専用文言にしていない (§2「検討したが見送ったもの」)。**移行直後に 404 を見たら `GEMINI_MODEL` の値を確認する**、と覚えておくこと

いずれも `lib/ai/__tests__/client.test.ts` にユニットテストがあるため、実 API での確認は任意。

### 5-D. 回帰確認

- [ ] `/research/[storeId]` の貼付 → 生成 → 編集 → 保存
- [ ] 生成後に stage が `DeepResearch済み` になる
- [ ] `架電済み` の店舗で生成しても stage が降格しない
- [ ] 店舗詳細の「営業資産を再生成」からの経路
- [ ] 追加指示を入れても出力 schema と発信者名が変わらない
- [ ] 貼付テキストなし (基本情報のみ) でも生成できる

---

## 6. Vercel Function の実行時間上限 (**要確認**)

`TIMEOUT_MS` を引き上げる判断には、Vercel Function の実際の上限が必要。

1. Vercel Dashboard → project `fw-sales` → **Settings → Functions** で Max Duration を確認する
2. team のプラン (Hobby / Pro / Enterprise) を確認する
3. `vercel.json` には現在 Function 設定が無く、`export const maxDuration` もリポジトリ内に 0 件

**上限が分からないまま `TIMEOUT_MS` を 90 秒等へ引き上げないこと。** Function 側が先に切れると、
`AbortSignal` による正常な timeout ではなくプラットフォーム側の打ち切りになり、UI に有用なエラーが出ない。

---

## 7. 異常時の切り替え (rollback)

> ### ⚠ 切り戻し先に deprecated な旧モデルを指定しない
>
> `gemini-2.5-*` は 2026-10-16 に必ず停止する。戻しても問題を先送りするだけで、期限当日に同じ障害が起きる。
> **切り戻しは「GA な代替モデルへ横に動く」こと。**

> ### ⚠ 切り戻し先のモデル ID は、切り替える時点で必ず公式の状態を再確認する
>
> 下表に挙げる `gemini-3.5-flash` / `gemini-3.5-flash-lite` は **2026-07-29 時点で GA** というだけであり、
> **将来も利用可能であることを保証する固定値ではない**。Gemini のモデルは GA 後も
> deprecated → シャットダウンの経路をたどる (現に `gemini-2.5-*` がそうなった)。
>
> 切り替える前に [Models](https://ai.google.dev/gemini-api/docs/models) と
> [Deprecations](https://ai.google.dev/gemini-api/docs/deprecations) を開き、
> **その時点で GA かつ deprecated でないモデル**を選ぶこと。本 runbook の値をそのまま貼らない。

| 事象 | 対応 (コード変更・再デプロイ不要) |
|---|---|
| `gemini-3.6-flash` の出力品質が期待に届かない | 同世代の代替モデルへ `GEMINI_MODEL` を切替 (2026-07-29 時点の候補: `gemini-3.5-flash`) |
| レイテンシが長すぎる / コストが高い | 低レイテンシ・低コスト系へ切替 (2026-07-29 時点の候補: `gemini-3.5-flash-lite`) |
| `MAX_TOKENS` 切断が出る | `lib/ai/client.ts` の `MAX_OUTPUT_TOKENS` を引き上げる修正 PR (現時点では env 化していない) |
| 404 が返る | まず `GEMINI_MODEL` の値を確認する (§4)。モデル ID のタイポ・廃止済みモデルが最有力 |
| 本 PR 自体に不具合 | `git revert`。**ただし revert すると既定値が `gemini-2.5-flash` に戻るため、必ず Vercel の `GEMINI_MODEL` にその時点の GA モデルを明示設定して停止リスクを残さないこと** |

`GEMINI_MODEL` は単なる設定項目ではなく**切り戻し経路そのもの**である。今後も残すこと。

---

## 8. Interactions API を今回採用しない理由

Gemini の **Interactions API は GA** であり、公式も「最新機能・モデルにはこちらを推奨」としている。
それでも本移行では `generateContent` (Legacy 表記) を維持した。

| 論点 | 判断 |
|---|---|
| `generateContent` は使えるか | **使える。** 現在も公式サポートされ、legacy 版ドキュメントに `gemini-3.6-flash` + Structured Outputs のサンプルが掲載されている |
| Interactions API の利点 | built-in tools (`google_search` / `url_context` / `google_maps` / `file_search`) の宣言、`background: true` による長時間ジョブ、`url_citation` 等の構造化 citation、modality 別 usage |
| その利点は営業資産生成に要るか | **要らない。** 本クライアントは「基本情報 + 貼付テキスト → 営業資産」の生成専用で、Web 調査を行わない |
| 移行の影響範囲 | リクエスト/レスポンス形状が別物 (`input` / `response_format` / `steps[]` / `annotations[]`)。`GeminiClient` interface、`AnalysisInput`、`normalizeSdkError`、client のテスト全体を書き換えることになる |
| **結論** | **採用しない。** モデル停止対応と API 基盤変更を同時に行うと切り戻し単位が粗くなる。本 PR の目的は「停止リスクの除去」だけに絞る |

### Issue #158 との責務分離

| | 営業資産生成 (本ファイル群) | Web 調査 (Issue #158) |
|---|---|---|
| モジュール | `lib/ai/client.ts` | `lib/ai/research/` (未実装) |
| API | `generateContent` | **Interactions API** |
| tools | 使わない | `google_search` + `url_context` |
| 入力 | 手元の基本情報 + 貼付テキスト | Web |
| 出力 | `AiAnalysisResult` | Evidence Bundle |

**Google Search / URL Context / Deep Research / Interactions API は Issue #158 側で扱う。**
本ファイルに tools を足さないこと。

---

## 9. SDK (`@google/genai`) について

**更新しない。現行 `1.52.0` のまま。**

型定義を実物確認した結果、本移行に必要な要素はすべて 1.52.0 で揃っている。

| 必要な機能 | 1.52.0 での状況 |
|---|---|
| モデルを文字列で指定 | `GenerateContentParameters.model: string` → `"gemini-3.6-flash"` を渡せる |
| `generateContent` | あり |
| Structured Outputs | `GenerateContentConfig.responseMimeType` / `responseJsonSchema` あり |
| sampling parameter の削除 | `temperature?` / `topP?` / `topK?` はいずれも optional → 消すだけでよい |
| `FinishReason.MAX_TOKENS` | enum として export 済み |
| (将来) Interactions API | `Interactions` クラス、`DeepResearchAgentConfig`、`response_format`、`background`、`webhook_config`、cancel まで型が揃っている |

npm の latest は `2.13.0` だが、メジャー 2 系への更新は破壊的変更の調査が別途必要で、
モデル停止対応と同時に行うと切り戻し単位が粗くなる。**Issue #158 で Interactions API を使う段になったら改めて評価する。**

`package.json` / `pnpm-lock.yaml` は本移行で変更していない。

---

## 10. 参考 (一次情報)

- [Gemini API — Models](https://ai.google.dev/gemini-api/docs/models)
- [Gemini API — Deprecations](https://ai.google.dev/gemini-api/docs/deprecations)
- [gemini-3.6-flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash)
- [Release notes](https://ai.google.dev/gemini-api/docs/changelog) — 2026-07-21 に `gemini-3.6-flash` / `gemini-3.5-flash-lite` が GA、`temperature` / `top_p` / `top_k` の deprecated 化
- [Gemini 3 Developer Guide (generateContent)](https://ai.google.dev/gemini-api/docs/generate-content/gemini-3) — `thinking_level`、sampling parameter の扱い
- [Structured outputs (generateContent, Legacy)](https://ai.google.dev/gemini-api/docs/generate-content/structured-output)
- [Structured outputs (Interactions)](https://ai.google.dev/gemini-api/docs/interactions/structured-output) — Structured Outputs × built-in tools
