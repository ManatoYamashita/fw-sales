/**
 * `@google/genai` SDK のラッパ。Server Action からのみ呼出される(`"server-only"` で隔離)。
 *
 * - API キーは `process.env.GEMINI_API_KEY`(`lib/env.ts` の `readEnv` 経由)
 * - モデルは `getGeminiModel()`(既定 `gemini-3.6-flash`、`GEMINI_MODEL` で上書き可)
 * - `generateContent` + `responseMimeType: "application/json"` + `responseJsonSchema` で
 *   構造化出力を強制
 * - SDK の生エラーは `AiClientError` discriminated union に正規化
 *   (API キー値や request ID の漏洩防止)
 *
 * ## built-in tools を使わない理由(2026-07 時点の事実に更新)
 *
 * 旧記述「Gemini API は構造化出力と `tools` の同時設定を 400 (INVALID_ARGUMENT) で拒否する」
 * は **Gemini 2.5 系での実機検証(2025-05-09)に基づく当時の事実**であり、現在は当てはまらない。
 * **Gemini 3 系では Structured Outputs と built-in tools(Grounding with Google Search /
 * URL Context / Code Execution / File Search / Function Calling)を併用できる。**
 *
 * それでも本ファイルが tools を使わないのは、能力の制約ではなく **責務の分離**による:
 * - 本クライアントは「店舗基本情報 + 貼付調査テキスト → 営業資産(`AiAnalysisResult`)」の
 *   生成専用であり、**Web 調査を行わない**。入力は既に手元にあるため tools が要らない。
 * - Google Search / URL Context を伴う Web 調査(AI 店舗調査再設計、Issue #158)は
 *   別モジュール `lib/ai/research/` として実装する。
 *
 * ## Web 調査側も Interactions API へは移行しない(2026-08 訂正)
 *
 * 本コメントは以前「Web 調査側は Interactions API を使う」としていたが、これは実機検証を
 * 伴わない当初の想定に過ぎなかった。実際には以下の実機 Spike (AI 店舗調査再設計 Plan v3.2
 * Spike 0 / Spike 0.1、`D:\tento\gemini-research-poc` 配下で実施)により、
 * **`generateContent` + `tools`(googleSearch / urlContext)+ Structured Output の組合せが
 * 正常動作することを実証済み**:
 * - `tools:[{urlContext:{}}]` + Structured Output: `urlContextMetadata` / `urlRetrievalStatus`
 *   / `usageMetadata` すべて正常に返る(Spike 0.1 Test A / Test C)。
 * - `tools:[{googleSearch:{}}]` + Structured Output: ツール自体は実際に呼ばれるが
 *   (`toolConfig.includeServerSideToolInvocations` で実証)、公式 `groundingMetadata` は
 *   返らない。そのため Web 調査側の設計は Stage1(Google Search 単独、Structured Output
 *   なし)と Stage2(URL Context 単独、Structured Output あり)に役割分離する
 *   (Plan v3.2 §8)。
 *
 * この実証結果があるため、Web 調査側も `generateContent` を使う(Interactions API へは
 * 移行しない)。Interactions API の利点(built-in tools / background 実行 / 構造化 citation)は
 * 実機検証していない前提の話であり、既に `generateContent` で必要な機能が確認できている以上、
 * 新しい API 基盤を追加導入する理由が無い(既存の営業資産生成 `generateContent` 経路も
 * 理由なく移行しない、という判断と同じ考え方)。
 *
 * ## sampling parameter を設定しない理由
 *
 * `temperature` / `topP` / `topK` は Gemini 3 系で deprecated。公式は「既定値から変えるな。
 * 下げると loop や性能劣化を起こしうる」としている。旧 `temperature: 0.4` は本移行で削除した。
 * **今後もこれらを設定しないこと。**
 *
 * 関連: design.md §「GeminiClient」, requirements.md §2.4, §2.6, §2.7, §6.1,
 *       docs/gemini-model-migration-runbook.md
 */

import "server-only";

import { FinishReason, GoogleGenAI, type Part } from "@google/genai";
import {
  isApiKeyConfigured as envIsApiKeyConfigured,
  getGeminiModel,
  readEnv,
} from "@/lib/env";

/**
 * 1 回の生成で許す出力トークン上限。
 *
 * **本移行では値を変更していない (旧 `gemini-2.5-flash` 時代と同じ 4096)。**
 * Gemini 3 系は thinking が既定で有効で思考トークンも出力枠を消費するため、この値が
 * 不足しうる。ただし適切な値は実 API を叩かないと決められないため、
 * **Preview 実測 (`docs/gemini-model-migration-runbook.md` の「実測して決める項目」) で
 * `finishReason` と `usageMetadata` を測ってから変更する**方針とした。
 * 実測前に推測で引き上げない。
 */
const MAX_OUTPUT_TOKENS = 4096;

export interface AnalysisInput {
  /** PromptBuilder が生成した system prompt 文字列 */
  systemPrompt: string;
  /** PromptBuilder が生成した user message Parts(JSON 化されたフォーム値、HTML、追加指示) */
  userParts: Part[];
  /** `lib/ai/schema.ts:getAiAnalysisJsonSchema()` で生成した JSON Schema */
  jsonSchema: Record<string, unknown>;
}

/**
 * SDK エラーを正規化した discriminated union。
 *
 * Server Action 層ではこの kind を見て `ActionResult.failure(message)` に変換する。
 * SDK の生エラーメッセージには API キー値や request ID が混入することがあるため、
 * 必ず本型に変換してから上位に流すこと。
 */
/**
 * Gemini の `usageMetadata` から取り出した **数値のみ** の内訳
 * (feat/ai-research-quality-ux-hardening、Theme 5B)。
 *
 * `lib/ai/research/client.ts:UsageMetadataLike` と同形だが、`lib/ai/client.ts` は
 * research モジュールへ依存しないため独立して定義する(依存方向を逆転させない)。
 * **数値以外のフィールドを増やさないこと。** DB とログの両方へ流れる。
 */
export interface AiTokenUsage {
  promptTokenCount: number | null;
  candidatesTokenCount: number | null;
  toolUsePromptTokenCount: number | null;
  thoughtsTokenCount: number | null;
  totalTokenCount: number | null;
}

export type AiClientError =
  | { kind: "missing_api_key" }
  | { kind: "timeout" }
  | { kind: "rate_limit"; retryAfterSeconds?: number }
  | { kind: "auth_error" }
  /**
   * `maxOutputTokens` に達して応答が打ち切られた (`finishReason === MAX_TOKENS`)。
   *
   * 構造化フィールド (`candidates[0].finishReason`) から判定するため、SDK のエラー文面に
   * 依存しない。Gemini 3 系は thinking が既定で有効で思考トークンも出力枠を消費するため、
   * 本移行で現実的に起こりうる失敗として専用分類にしている。
   *
   * `usage` は **数値のみ** の sanitized な内訳(feat/ai-research-quality-ux-hardening、
   * Theme 5B)。実機の MAX_TOKENS run では `token_usage = null` になり、
   * thinking と candidates のどちらが伸びたのかを事後に判断できなかった。
   * この失敗経路でのみ usage を運ぶことで、`markFailedStep` が DB へ保存し
   * 対策の効果測定ができるようにする。**raw response / prompt は絶対に載せない。**
   */
  | { kind: "max_tokens"; usage?: AiTokenUsage }
  | { kind: "api_error"; status: number }
  | { kind: "network_error" }
  | { kind: "unknown"; message: string };

/**
 * `AiClientError["kind"]` の全値。`isAiClientError` の判定表。
 *
 * `Record<AiClientError["kind"], true>` にすることで **union に kind を足したときに
 * ここへの追加漏れがコンパイルエラーになる** (キー不足も余剰も型エラー)。
 * 配列 + `satisfies` では「不足」を検出できないため、意図的に Record を使う。
 */
const AI_CLIENT_ERROR_KINDS: Record<AiClientError["kind"], true> = {
  missing_api_key: true,
  timeout: true,
  rate_limit: true,
  auth_error: true,
  max_tokens: true,
  api_error: true,
  network_error: true,
  unknown: true,
};

export interface GeminiClient {
  /**
   * Gemini API を呼出して raw な JSON レスポンスを返す。
   *
   * - 成功時は parsed object(`unknown` 型、呼出元で `validateAiAnalysis()` を通すこと)
   * - 失敗時は `AiClientError` を throw
   * - `signal` は AbortController.signal を期待(60 秒タイムアウト等の中断制御)
   */
  generateAnalysis(
    input: AnalysisInput,
    signal: AbortSignal,
  ): Promise<unknown>;
}

/**
 * API キーが設定済みかを返す。`lib/env.ts` の同名関数を再 export する形。
 *
 * Client Component から SSR 経由で boolean を受け取り、`[AI で分析]` ボタンの
 * disabled 制御に使う想定(Req 2.7)。本関数は Server / Client いずれからも安全に呼べる
 * (`lib/env.ts` は `server-only` 隔離していないため)。
 */
export function isApiKeyConfigured(): boolean {
  return envIsApiKeyConfigured();
}

/**
 * Gemini Client を生成する。各呼出ごとに新規 SDK インスタンスを作る。
 *
 * インスタンスを reuse する singleton 化でレイテンシ短縮の余地があるが、
 * MVP では呼出毎に生成して動作確認後に最適化を検討する(tasks.md Implementation Notes 参照)。
 */
export function createGeminiClient(): GeminiClient {
  return {
    async generateAnalysis(input, signal) {
      const apiKey = readEnv("GEMINI_API_KEY");
      if (!apiKey) {
        throw makeError({ kind: "missing_api_key" });
      }
      const model = getGeminiModel();
      const ai = new GoogleGenAI({ apiKey });

      try {
        const response = await ai.models.generateContent({
          model,
          contents: [
            {
              role: "user",
              parts: input.userParts,
            },
          ],
          config: {
            systemInstruction: input.systemPrompt,
            responseMimeType: "application/json",
            responseJsonSchema: input.jsonSchema,
            // temperature / topP / topK は設定しない (Gemini 3 系で deprecated)。
            // 詳細はファイル冒頭 JSDoc「sampling parameter を設定しない理由」を参照。
            maxOutputTokens: MAX_OUTPUT_TOKENS,
            abortSignal: signal,
          },
        });

        // 長さ上限による打ち切りを、空応答より先に専用分類へ落とす。
        // Gemini 3 系は thinking が既定で有効で、思考トークンも出力枠を消費するため、
        // 本文が 1 文字も出ないまま MAX_TOKENS に到達しうる。この場合に
        // 「応答が空でした」とだけ表示すると、原因が maxOutputTokens 不足だと分からない。
        if (response.candidates?.[0]?.finishReason === FinishReason.MAX_TOKENS) {
          throw makeError({ kind: "max_tokens" });
        }

        const text = response.text;
        if (typeof text !== "string" || text.length === 0) {
          throw makeError({
            kind: "unknown",
            message: "AI 分析の応答が空でした",
          });
        }
        return parseJsonResponse(text);
      } catch (err) {
        throw normalizeSdkError(err);
      }
    },
  };
}

/**
 * 応答本文を JSON としてパースする。失敗は必ず定型の `unknown` へ変換する。
 *
 * `JSON.parse` の `SyntaxError` を SDK エラーと同じ `normalizeSdkError` に流さないために
 * 分離している。`normalizeSdkError` はメッセージ中の 3 桁数字を HTTP ステータスとみなす
 * ヒューリスティックを持つため、パース位置が 4xx / 5xx のとき
 * (例: `Unterminated string in JSON at position 466`) 実際には起きていない
 * `api_error(466)` に誤分類されてしまう。
 *
 * 併せて、応答本文そのもの (第三者サイト由来のテキストを含みうる) を上位へ渡さない。
 */
function parseJsonResponse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw makeError({
      kind: "unknown",
      message: "AI 分析の応答を JSON として解釈できませんでした",
    });
  }
}

/**
 * SDK エラーが構造化された HTTP ステータスを持っていれば返す。
 *
 * `@google/genai` の `ApiError` は `status: number` を持つ。メッセージ文字列の数字を
 * 拾うより信頼でき、`models/xxx is NOT_FOUND for API version v1beta` のように
 * **数字を含まない文面でもステータスを失わない**。
 *
 * SDK のクラスに `instanceof` で依存すると SDK 更新時に壊れうるため、`status` プロパティの
 * duck typing で読む。HTTP エラーとして意味のある 400-599 のみ採用する。
 */
function readStructuredStatus(err: unknown): number | null {
  if (typeof err !== "object" || err === null) return null;
  const status = (err as { status?: unknown }).status;
  if (typeof status !== "number" || !Number.isInteger(status)) return null;
  return status >= 400 && status <= 599 ? status : null;
}

/**
 * API キー不正を示す marker。**小文字化したメッセージへの部分一致**で使う。
 *
 * - `api_key_invalid`: `google.rpc.ErrorInfo` の `reason`。SDK が レスポンス body 全体を
 *   `JSON.stringify` して `message` に入れるため `"reason":"API_KEY_INVALID"` として現れる。
 * - `api key not valid`: Google が返す `error.message` 本文
 *   (`API key not valid. Please pass a valid API key.`)。body を stringify せず
 *   `error.message` だけを載せるエラー形状でも拾えるようにするための冗長化。
 *
 * **意図的に狭くしている。** 単なる `"api key"` では
 * `Invalid JSON payload received. Unknown name "api_key..."` のような通常の
 * malformed request まで巻き込むため使わない。
 */
const INVALID_API_KEY_MARKERS = ["api_key_invalid", "api key not valid"] as const;

/**
 * SDK エラーが「API キーが無効」を示しているかを判定する。
 *
 * Gemini API は**無効な API キーに対して 401 ではなく 400
 * (`INVALID_ARGUMENT` / `reason: API_KEY_INVALID`) を返す**。構造化ステータスだけで
 * 分類すると `api_error(400)` に落ち、UI が「再度お試しください」と案内してしまうが、
 * 実際には再試行しても直らない恒久的な設定不備であり、正しい案内は
 * 「GEMINI_API_KEY を確認してください」(= `auth_error`) である。
 *
 * `@google/genai` 1.52.0 の `ApiError` は `{ message, status }` しか持たず、
 * `details[].reason` を構造化プロパティとして公開していない (`ApiErrorInfo` の型定義参照)。
 * 一方 `message` にはレスポンス body 全体が `JSON.stringify` されて入るため、
 * **文言による判定しか採れない**。誤検知を避けるため、呼出側で
 * **`status === 400` のときだけ**本関数を適用すること。
 *
 * 判定に使ったメッセージは上位へ一切返さない (返すのは `kind` のみ)。
 */
function looksLikeInvalidApiKey(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return INVALID_API_KEY_MARKERS.some((marker) => msg.includes(marker));
}

/**
 * Google API 標準の列挙値 (`error.status` / `google.rpc.ErrorInfo.reason`) を
 * **JSON のキー位置に固定して**取り出す正規表現 (runtime reliability hardening、F4)。
 *
 * `[A-Z][A-Z0-9_]{2,63}` の shape guard により、抽出されうるのは UPPER_SNAKE_CASE の
 * 列挙トークンのみになる:
 * - API キー (`AIzaSy...`) は大小混在なので終端の `"` までマッチしない
 * - request ID (UUID) はハイフン・小文字を含むのでマッチしない
 * - `error.message` の自由文 (空白・日本語・記号を含む) はマッチしない
 * - 64 文字を超える値はマッチしない
 */
const PROVIDER_STATUS_PATTERN = /"status"\s*:\s*"([A-Z][A-Z0-9_]{2,63})"/;
const PROVIDER_REASON_PATTERN = /"reason"\s*:\s*"([A-Z][A-Z0-9_]{2,63})"/;

/**
 * 構造化ログ専用の sanitized な provider 診断情報。
 * **`AiClientError` には載せない**(DB `error_message` / UI へ流出させないため)。
 */
export interface ProviderDiagnostics {
  /** SDK が公開する HTTP ステータス (`ApiError.status`)。 */
  http_status?: number;
  /** Google API の `error.status` 列挙値 (例 `RESOURCE_EXHAUSTED`)。 */
  provider_status?: string;
  /** `google.rpc.ErrorInfo.reason` 列挙値 (例 `RATE_LIMIT_EXCEEDED`)。 */
  provider_reason?: string;
  /**
   * `google.rpc.BadRequest.fieldViolations[].field` のうち、**API のフィールドパス**
   * として厳格に検証できたものだけ (PR #180、Stage2 400 observability)。
   * 例: `generation_config.response_json_schema` / `contents[0].parts[0].text`。
   *
   * 400 INVALID_ARGUMENT が「request config(schema)側」か「動的 prompt(contents)側」か
   * を切り分ける唯一の provider 由来 signal。値ではなく**フィールド名**なので安全。
   * 同じ violation の `description` は自由文(prompt 断片・店舗名を含みうる)のため
   * **絶対に載せない**。
   */
  provider_field_violations?: string[];
  /**
   * `error.details[]["@type"]` の**末尾トークンのみ** (例 `BadRequest` / `ErrorInfo`)。
   * `type.googleapis.com/...` のような URL 形状は載せない。
   */
  provider_detail_types?: string[];
}

/**
 * `fieldViolations[].field` として採用してよい **API フィールドパス**の形。
 *
 * Google の field path は protobuf のフィールド名(lower_snake_case)とインデックスの
 * 組み合わせに限られる。この shape guard により、抽出されうるのは
 * `contents` / `contents[0].parts[0].text` / `generation_config.response_json_schema`
 * のような**構造上のパス**だけになる:
 * - 空白・引用符・コロン・スラッシュを含む自由文はマッチしない
 * - URL (`https://...`) はスラッシュとコロンでマッチしない
 * - 日本語・大文字を含む値(店舗名・prompt 断片・camelCase の自由文)はマッチしない
 *
 * **マッチしない値は加工せず完全に drop する。**
 */
const PROVIDER_FIELD_PATH_PATTERN = /^[a-z0-9_]+(?:\.[a-z0-9_]+|\[\d+\])*$/;
const MAX_PROVIDER_FIELD_PATH_LENGTH = 160;
/** `@type` の末尾トークン (`google.rpc.BadRequest` → `BadRequest`) として採用してよい形。 */
const PROVIDER_DETAIL_TYPE_PATTERN = /^[A-Za-z][A-Za-z0-9]{1,63}$/;
/** ログが肥大化しないための件数上限(どちらも dedupe 後に適用)。 */
const MAX_PROVIDER_DETAIL_ENTRIES = 5;

/**
 * `ApiError.message` を **strict に JSON.parse** し、`error.details[]` 配列だけを返す。
 *
 * `@google/genai` 1.52.0 は非2xx応答で error body 全体を `JSON.stringify` して
 * `ApiError.message` に入れる(`dist/index.mjs` の `!response.ok` 分岐)。したがって
 * 構造として辿れる。**自由文から広い正規表現で field path を探索する設計は採らない**
 * (自由文の一部を誤って field path として拾い、prompt 断片を露出させうるため)。
 *
 * parse 失敗・期待 shape でない場合は空配列を返して safe degrade する(throw しない)。
 */
function readProviderErrorDetails(err: unknown): unknown[] {
  if (!(err instanceof Error)) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(err.message);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) return [];
  const error = (parsed as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return [];
  const details = (error as { details?: unknown }).details;
  return Array.isArray(details) ? details : [];
}

/** dedupe + 件数上限を適用した配列を返す(空なら `undefined`)。 */
function cappedUnique(values: readonly string[]): string[] | undefined {
  const unique = [...new Set(values)].slice(0, MAX_PROVIDER_DETAIL_ENTRIES);
  return unique.length > 0 ? unique : undefined;
}

function extractFieldViolations(details: readonly unknown[]): string[] | undefined {
  const fields: string[] = [];
  for (const detail of details) {
    if (typeof detail !== "object" || detail === null) continue;
    const violations = (detail as { fieldViolations?: unknown }).fieldViolations;
    if (!Array.isArray(violations)) continue;
    for (const violation of violations) {
      if (typeof violation !== "object" || violation === null) continue;
      // `description` は自由文なので読まない。`field` のみ。
      const field = (violation as { field?: unknown }).field;
      if (typeof field !== "string") continue;
      if (field.length === 0 || field.length > MAX_PROVIDER_FIELD_PATH_LENGTH) continue;
      if (!PROVIDER_FIELD_PATH_PATTERN.test(field)) continue;
      fields.push(field);
    }
  }
  return cappedUnique(fields);
}

function extractDetailTypes(details: readonly unknown[]): string[] | undefined {
  const types: string[] = [];
  for (const detail of details) {
    if (typeof detail !== "object" || detail === null) continue;
    const raw = (detail as Record<string, unknown>)["@type"];
    if (typeof raw !== "string") continue;
    // `type.googleapis.com/google.rpc.BadRequest` → `BadRequest`
    const suffix = raw.split(/[./]/).pop();
    if (suffix === undefined || !PROVIDER_DETAIL_TYPE_PATTERN.test(suffix)) continue;
    types.push(suffix);
  }
  return cappedUnique(types);
}

/**
 * 文字列に **unpaired UTF-16 surrogate** が含まれるかを判定する
 * (PR #180、Stage2 400 INVALID_ARGUMENT の候補B観測)。
 *
 * ## なぜ必要か
 *
 * Stage2 prompt には Stage1 モデル生成テキスト(`[SOURCE] title:` や Search Note の
 * summary)がそのまま埋め込まれる。lone surrogate が混入すると `JSON.stringify` は
 * `\udXXX` エスケープとして送出し、Google 側の JSON→proto 変換が invalid UTF-8 として
 * `INVALID_ARGUMENT` を返しうる。これを boolean 1つで観測できるようにする。
 *
 * ## 診断専用
 *
 * **この関数の結果で prompt を書き換えたり sanitize したり run を失敗させたりしない。**
 * 判定するだけで、provider へは従来どおり同じ文字列を送る。
 *
 * 純関数。入力を変更しない。
 */
export function hasUnpairedSurrogate(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      // high surrogate: 直後が low surrogate でなければ unpaired。
      const next = i + 1 < text.length ? text.charCodeAt(i + 1) : NaN;
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i += 1; // 正常なペアなので low 側を読み飛ばす
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      // high surrogate に続かない low surrogate は常に unpaired。
      return true;
    }
  }
  return false;
}

/**
 * SDK 生エラーから、**構造化ログへ出しても安全なスカラーだけ**を取り出す。
 *
 * ## なぜ必要か
 *
 * `@google/genai` 1.52.0 の `ApiError` は `{ message, status }` しか公開せず
 * (`ApiErrorInfo` の型定義)、HTTP headers (`Retry-After` 等) は SDK 内部で破棄される。
 * `error.details[]` / `error.status` は **`message` に `JSON.stringify` された文字列
 * としてのみ**存在する。したがって構造化フィールドとしてのアクセスは不可能で、
 * 文字列からの抽出しか採れない (既存 `looksLikeInvalidApiKey` と同じ制約)。
 *
 * 2026-08 の実障害では Gemini の billing / prepaid credit 枯渇が 429 として届き、
 * `rate_limit` に分類されて 30 秒待って 1 retry した末に失敗していた。
 * 一時的な rate limit と billing 枯渇を安全に区別できる signal が現時点では
 * 確認できていないため、**分類は増やさず**、次回に切り分けられるよう provider 側の
 * 列挙トークンだけをログへ残す。
 *
 * ## 制約 (必ず守ること)
 *
 * - 戻り値は shape guard を通した列挙トークンと HTTP status のみ。
 * - この戻り値を `AiClientError` / DB / UI へ載せないこと。用途は構造化ログのみ。
 * - 呼び出し側は `console.error(..., err)` のように**元 Error を渡さない**こと。
 */
export function extractProviderDiagnostics(err: unknown): ProviderDiagnostics {
  const diagnostics: ProviderDiagnostics = {};

  const status = readStructuredStatus(err);
  if (status !== null) diagnostics.http_status = status;

  if (err instanceof Error) {
    const providerStatus = err.message.match(PROVIDER_STATUS_PATTERN)?.[1];
    if (providerStatus !== undefined) diagnostics.provider_status = providerStatus;
    const providerReason = err.message.match(PROVIDER_REASON_PATTERN)?.[1];
    if (providerReason !== undefined) diagnostics.provider_reason = providerReason;
  }

  // PR #180: `error.details[]` を構造として辿り、厳格 shape guard を通った
  // フィールドパス / detail type だけを追加する(通らなければ完全に drop)。
  const details = readProviderErrorDetails(err);
  if (details.length > 0) {
    const fieldViolations = extractFieldViolations(details);
    if (fieldViolations !== undefined) diagnostics.provider_field_violations = fieldViolations;
    const detailTypes = extractDetailTypes(details);
    if (detailTypes !== undefined) diagnostics.provider_detail_types = detailTypes;
  }

  return diagnostics;
}

/**
 * SDK 生エラーを `AiClientError` に正規化する。
 *
 * 重要: 生エラーメッセージには API キー先頭文字や internal request ID が混入することがある。
 * 必ず正規化済メッセージのみを上位に返すこと(client / log への漏洩防止)。
 *
 * 分類の優先順:
 * 1. 正規化済 `AiClientError` はそのまま
 * 2. AbortError → timeout / fetch 失敗 → network_error
 * 3. **構造化ステータス** (`err.status`) があればそれで分類。
 *    ただし 400 だけは例外で、内容が API キー不正 (Gemini は 401 ではなく 400 で返す) を
 *    示す場合に限り `auth_error` へ寄せる。それ以外の 400 は `api_error(400)` のまま。
 * 4. 無ければメッセージ文字列のヒューリスティック (旧 SDK / 想定外の形状向けフォールバック)
 */
/**
 * `lib/ai/research/` (AI 店舗調査、Issue #158) からも再利用する。同じ `@google/genai` SDK・
 * 同じ Gemini API を呼ぶ以上、エラー分類ロジックを複製すると新 kind 追加時の更新漏れ
 * (`isAiClientError` の JSDoc 参照)が2箇所で起きうるため、この関数を単一の真実とする。
 */
export function normalizeSdkError(err: unknown): AiClientError {
  // 既に正規化済の AiClientError(makeError 経由)はそのまま再 throw
  if (isAiClientError(err)) {
    return err;
  }
  // AbortSignal によるキャンセル → timeout
  if (err instanceof DOMException && err.name === "AbortError") {
    return { kind: "timeout" };
  }
  // fetch ネットワーク失敗
  if (err instanceof TypeError && err.message.toLowerCase().includes("fetch")) {
    return { kind: "network_error" };
  }
  // 構造化ステータスを最優先。401 / 429 はより具体的な kind を与える。
  const structuredStatus = readStructuredStatus(err);
  if (structuredStatus !== null) {
    if (structuredStatus === 401 || structuredStatus === 403) {
      return { kind: "auth_error" };
    }
    if (structuredStatus === 429) {
      return { kind: "rate_limit" };
    }
    // 400 は原則 api_error だが、API キー不正だけは例外的に auth_error へ寄せる。
    // Gemini は無効な API キーを 401 ではなく 400 (INVALID_ARGUMENT / API_KEY_INVALID)
    // で返すため、api_error(400) のままだと恒久的な設定不備に対して UI が
    // 「再度お試しください」と誤案内する。通常の malformed request (INVALID_ARGUMENT) は
    // marker を含まないため api_error(400) のまま。
    if (structuredStatus === 400 && looksLikeInvalidApiKey(err)) {
      return { kind: "auth_error" };
    }
    return { kind: "api_error", status: structuredStatus };
  }
  // SDK が Error に乗せてくるメッセージから分類 (構造化ステータスが無い場合のみ)
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (
      msg.includes("401") ||
      msg.includes("unauthorized") ||
      msg.includes("api key")
    ) {
      return { kind: "auth_error" };
    }
    if (
      msg.includes("429") ||
      msg.includes("rate limit") ||
      msg.includes("quota")
    ) {
      return { kind: "rate_limit" };
    }
    // 注: モデル ID 誤設定 (404 / NOT_FOUND) を専用 kind にすることも検討したが、
    // 「404 = モデル不存在」と断定できる構造化シグナルを SDK の型から確認できなかったため
    // 見送った (実 API を叩かずに安全な判定条件を確定できない)。404 は api_error(404) と
    // して扱い、UI にステータスコードを出す。移行直後に 404 が出た場合の切り分け手順は
    // docs/gemini-model-migration-runbook.md に記載する。
    const statusMatch = err.message.match(/\b([45]\d\d)\b/);
    if (statusMatch && statusMatch[1] !== undefined) {
      const status = Number.parseInt(statusMatch[1], 10);
      if (Number.isFinite(status)) {
        return { kind: "api_error", status };
      }
    }
    return {
      kind: "unknown",
      message: "AI 分析の呼出でエラーが発生しました",
    };
  }
  return {
    kind: "unknown",
    message: "AI 分析の呼出で不明なエラーが発生しました",
  };
}

/** `lib/ai/research/` からも再利用する(上記 `normalizeSdkError` と同じ理由)。 */
export function makeError(err: AiClientError): AiClientError {
  return err;
}

/**
 * `AiClientError` かを判定する。`AI_CLIENT_ERROR_KINDS` を単一の真実として引くため、
 * union に kind を足したときにここの更新漏れが起きない
 * (`Record<AiClientError["kind"], true>` がキー不足をコンパイルエラーにする)。
 *
 * Server Action 層 (`sales-assets-actions.ts`) からも使う。以前は同じ判定が action 側に
 * 複製されていたが、kind を追加したときに片方だけ更新されると **新 kind が
 * 「不明なエラー」に落ちて UI から原因が読めなくなる**ため、本関数へ一本化した。
 */
export function isAiClientError(err: unknown): err is AiClientError {
  if (typeof err !== "object" || err === null) return false;
  if (!("kind" in err)) return false;
  const kind = (err as { kind: unknown }).kind;
  return typeof kind === "string" && Object.hasOwn(AI_CLIENT_ERROR_KINDS, kind);
}
