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
   */
  | { kind: "max_tokens" }
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
