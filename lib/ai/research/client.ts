/**
 * AI 店舗調査(Stage1 Source Discovery / Stage2 FACT・ANALYSIS)の Gemini API クライアント。
 * AI 店舗調査再設計(Plan v3.2 §8, PR2)。`import "server-only"` で隔離。
 *
 * `lib/ai/client.ts`(営業資産生成)とは責務が異なる独立モジュールとして実装する
 * (`lib/ai/client.ts` 冒頭 JSDoc 参照)。ただし SDK エラー正規化(`AiClientError` /
 * `normalizeSdkError` / `isAiClientError`)は同じ Gemini API を叩く以上ロジックを
 * 複製せず再利用する。
 *
 * Stage1: `tools:[{googleSearch:{}}]` のみ。Structured Output は使わない
 * (Spike 0.1 で groundingMetadata が失われないことを実証済み)。
 * Stage2: `tools:[{urlContext:{}}]` のみ(Google Searchは使わない)+ Structured Output
 * (Spike 0.1 Test A/C で urlContextMetadata が正常に返ることを実証済み)。
 */

import "server-only";

import { GoogleGenAI, FinishReason } from "@google/genai";
import { readEnv, getResearchGeminiModel, getResearchMaxOutputTokens } from "@/lib/env";
import {
  normalizeSdkError,
  makeError,
  extractProviderDiagnostics,
  hasControlChars,
  hasUnpairedSurrogate,
  type AiClientError,
} from "@/lib/ai/client";
import type { GroundingMetadataLike } from "./source-registry";

export interface UsageMetadataLike {
  promptTokenCount: number | null;
  candidatesTokenCount: number | null;
  toolUsePromptTokenCount: number | null;
  thoughtsTokenCount: number | null;
  totalTokenCount: number | null;
}

export interface UrlContextMetadataLike {
  urlMetadata: { retrievedUrl: string | null; status: string | null }[];
}

export interface Stage1CallResult {
  text: string;
  groundingMetadata: GroundingMetadataLike | null;
  usageMetadata: UsageMetadataLike | null;
  /**
   * Google Search のserver-side tool call回数(fix/ai-research-poc-like-retrieval で追加)。
   * `groundingMetadata` が欠落する場合でも(Spike 0.2で実証済みの実機挙動)、
   * 「Searchを呼ばなかった」のか「呼んだが結果が空だった」のかを事後に区別するための
   * 最低限の診断情報。検索クエリ文字列そのものは保存しない(件数のみ)。
   */
  searchCallCount: number;
  /** 上記tool callに含まれた検索クエリの合計件数。 */
  searchQueryCount: number;
  /**
   * 食べログ(グルメポータル)向けの検索を実際に試みたか
   * (PR #180 final smoke hardening、BLOCKER 1 observability)。
   *
   * **判定元は Stage1 モデル出力の `[QUERY]` 自己申告ではなく、
   * server-side tool invocation の実際の `toolCall.args.queries`。**
   * `[QUERY]` は「実行したつもり」を書けてしまうため、mandatory search attempt の
   * 遵守確認には使えない。
   *
   * `false` でも run は失敗させない(モデルの tool choice による一時的な非遵守で
   * 正常な調査全体を落とすのは強すぎるため)。次回 Preview smoke の必須確認項目として
   * 観測できるようにするための診断値。
   */
  tabelogSearchAttempted: boolean;
}

export interface Stage2CallResult {
  rawText: string;
  urlContextMetadata: UrlContextMetadataLike | null;
  usageMetadata: UsageMetadataLike | null;
}

/**
 * Stage2 request の**性質だけ**を表す sanitized な診断値(PR #180、Stage2 400 observability)。
 *
 * 監査で、Stage2 `400 INVALID_ARGUMENT` が
 *
 * - Stage0 Places 修正より前(2026-08-03)から断続的に発生していること
 * - 41-key / 39-key のどちらでも発生し、どちらでも成功もしていること
 * - 同一店舗・同一コードで数分後の再実行が成功する事例が複数あること
 * - DB に残る Source Registry の特徴量(件数・URL 形式・重複・type 構成)では
 *   400 と成功が一切分離しないこと
 *
 * が確定した。残る未観測の request 側 signal を、次回1回の smoke で確定させるために
 * **count と boolean だけ**を記録する。
 *
 * ## 不変条件
 *
 * - **数値と boolean のみ。** URL・prompt 本文・schema 本文・店舗名・住所・電話番号を
 *   1つも保持しない(型として持てない)
 * - `AiClientError` にも DB にも載せない(ログ専用)。既存 `ProviderDiagnostics` と同じ境界
 * - この値で prompt / schema / request を書き換えない。観測するだけ
 * - 失敗時の catch 内でのみ組み立てる(成功パスにコストをかけない)
 */
/**
 * **構造化入力から導ける**部分。`runStage2`(`pipeline.ts`)が
 * `allowedKeys` / `sourceRegistry` / `searchNotes` / `jsonSchema` から組み立てる。
 * prompt テキストの走査で再導出しない(構造化データがある値をテキスト解析しない)。
 */
export interface Stage2RequestShape {
  /** Stage2 が担当する項目数(= `allowedKeys.length`)。41 / 39 を実測で確定させる。 */
  stage2_item_count: number;
  /** Source Registry のエントリ数(= prompt に列挙される URL 数)。 */
  source_registry_count: number;
  /** 上記のうち URL として一意なものの数。 */
  unique_url_count: number;
  /** `new URL()` が失敗したエントリ数。 */
  invalid_url_count: number;
  /** prompt に実際に埋め込まれる Search Note の件数(registry と URL 一致したもの)。 */
  search_note_count: number;
  /** `JSON.stringify(jsonSchema)` の UTF-8 バイト長。schema 本文は保持しない。 */
  schema_utf8_byte_count: number;
}

/**
 * **prompt の走査が必要な**部分。`runStructuredUrlContext` の catch 内でのみ算出する
 * (成功パスにコストをかけない、という既存 `prompt_has_unpaired_surrogate` の方針を維持)。
 */
export interface Stage2PromptShape {
  /** prompt の UTF-16 コード単位長。 */
  prompt_char_count: number;
  /** prompt の UTF-8 バイト長。 */
  prompt_utf8_byte_count: number;
  /** prompt に C0 制御文字 / U+2028 / U+2029 が含まれるか。 */
  has_control_chars: boolean;
  /** prompt に unpaired UTF-16 surrogate が含まれるか。 */
  prompt_has_unpaired_surrogate: boolean;
}

export type Stage2RequestDiagnostics = Stage2RequestShape & Stage2PromptShape;

export interface ResearchGeminiClient {
  /** Stage1: Google Search単独。Structured Outputは使わない。 */
  runSourceDiscovery(prompt: string, signal: AbortSignal): Promise<Stage1CallResult>;
  /** Stage2: URL Context単独 + Structured Output。 */
  runStructuredUrlContext(
    params: {
      prompt: string;
      jsonSchema: Record<string, unknown>;
      /**
       * 失敗時ログ専用の sanitized な request 診断(count のみ)。
       * **provider へ送る request には一切影響しない。** 省略可(既存呼び出しの後方互換)。
       */
      diagnostics?: Stage2RequestShape;
    },
    signal: AbortSignal,
  ): Promise<Stage2CallResult>;
}

/**
 * 食べログ向け検索と判定するクエリ内の部分文字列(小文字化後に比較する)。
 * 「食べログ」表記と `site:tabelog.com` 形式の両方を拾う。
 * ここに現れるのは**サイトの識別子のみ**であり、店舗名・電話番号は含めない。
 */
const TABELOG_QUERY_MARKERS = ["食べログ", "tabelog.com"] as const;

function isTabelogQuery(query: string): boolean {
  const normalized = query.toLowerCase();
  return TABELOG_QUERY_MARKERS.some((marker) => normalized.includes(marker));
}

/**
 * server-side tool invocation parts(`toolConfig.includeServerSideToolInvocations`有効時に
 * 含まれる)から、Google Searchの呼出回数・クエリ件数・食べログ検索の試行有無のみを抽出する。
 *
 * **クエリ文字列そのものはこの関数の中だけで評価し、返り値へは一切載せない**
 * (個人情報・生レスポンス非保存の方針)。呼び出し元へ渡るのは件数2つと boolean 1つだけで、
 * `Stage1CallResult` → `Stage1Outcome` → DB `token_usage.stage1_diagnostics` の
 * どの段階にも raw query は存在しない。log へも出さない。
 *
 * `tabelogSearchAttempted` の判定元は**実際の tool invocation の `args.queries`** であり、
 * モデルが本文へ書く `[QUERY]` 自己申告ではない(PR #180 BLOCKER 1)。
 */
function extractSearchDiagnostics(
  parts: unknown,
): { searchCallCount: number; searchQueryCount: number; tabelogSearchAttempted: boolean } {
  if (!Array.isArray(parts)) {
    return { searchCallCount: 0, searchQueryCount: 0, tabelogSearchAttempted: false };
  }

  let searchCallCount = 0;
  let searchQueryCount = 0;
  let tabelogSearchAttempted = false;
  for (const part of parts as Array<{ toolCall?: { args?: Record<string, unknown> } }>) {
    const args = part.toolCall?.args;
    if (!args) continue;
    searchCallCount += 1;
    const queries = args.queries;
    if (Array.isArray(queries)) {
      searchQueryCount += queries.length;
      for (const query of queries) {
        if (typeof query === "string" && isTabelogQuery(query)) {
          tabelogSearchAttempted = true;
        }
      }
    }
  }
  return { searchCallCount, searchQueryCount, tabelogSearchAttempted };
}

function extractUsageMetadata(um: unknown): UsageMetadataLike | null {
  if (!um || typeof um !== "object") return null;
  const u = um as Record<string, unknown>;
  return {
    promptTokenCount: typeof u.promptTokenCount === "number" ? u.promptTokenCount : null,
    candidatesTokenCount:
      typeof u.candidatesTokenCount === "number" ? u.candidatesTokenCount : null,
    toolUsePromptTokenCount:
      typeof u.toolUsePromptTokenCount === "number" ? u.toolUsePromptTokenCount : null,
    thoughtsTokenCount: typeof u.thoughtsTokenCount === "number" ? u.thoughtsTokenCount : null,
    totalTokenCount: typeof u.totalTokenCount === "number" ? u.totalTokenCount : null,
  };
}

/**
 * Gemini 呼出失敗を **sanitized な structured log** として記録する
 * (runtime reliability hardening、F3/F4)。
 *
 * 従来 `lib/ai/` と `workflows/` には `console.*` が 1 つも無く、Gemini がどの HTTP status /
 * provider reason で落ちたかは Vercel logs に残らなかった。2026-08 の billing 障害では
 * `store_research_runs.error_kind` を Supabase で直接見るしか診断手段がなく、しかもその値は
 * `fatal:rate_limit` で「一時的な rate limit」と区別がつかなかった。
 *
 * ここが provider 側の生情報に触れられる最後の地点なので、`extractProviderDiagnostics`
 * を通した列挙トークンだけをログへ出す。**`AiClientError` には載せない**
 * (DB `error_message` / UI へ流出させないため)。
 *
 * 制約:
 * - 元 Error オブジェクトを `console.error` へ渡さない(スタックや raw message が出る)。
 * - raw `err.message` / レスポンス本文 / request ID / API key / headers は出さない。
 * - `AiClientError` の `message` フィールド(`unknown` kind が持つ定型文)も出さない。
 */
function logGeminiCallFailure(
  stage: "stage1" | "stage2",
  err: unknown,
  kind: AiClientError["kind"],
  requestDiagnostics?: RequestDiagnostics,
): void {
  console.error("[research.gemini] call failed", {
    stage,
    kind,
    ...extractProviderDiagnostics(err),
    ...(requestDiagnostics ?? {}),
  });
}

/**
 * 失敗ログにだけ添える **request 側の sanitized 診断**(PR #180、Stage2 400 observability)。
 *
 * `extractProviderDiagnostics` が provider 応答側を担うのに対し、こちらは
 * 「我々が送ったリクエストの性質」を count / boolean で記録する。
 * **数値と boolean のみ。** raw prompt・URL・schema 本文・文字位置・文字コード・
 * 周辺文字は一切出さない。`AiClientError` にも DB にも載せない(ログ専用)。
 *
 * 実体は `Stage2RequestDiagnostics`(公開型)。呼び出し側(`pipeline.ts`)が
 * 構造化入力から組み立てたものをそのまま受け取る。
 */
type RequestDiagnostics = Partial<Stage2RequestDiagnostics>;

/**
 * MAX_TOKENS 到達時の token 内訳を **sanitized な structured log** として記録する
 * (feat/ai-research-quality-ux-hardening、Theme 5B)。
 *
 * 実機の MAX_TOKENS run では `token_usage = null` で、
 * 「thinking が伸びたのか candidates が伸びたのか」を事後に切り分けられなかった。
 * 出力枠(`maxOutputTokens`)を消費するのは `thoughtsTokenCount + candidatesTokenCount`
 * だけであり(`toolUsePromptTokenCount` / `promptTokenCount` は入力側)、
 * この内訳が無いと対策(上限引き上げ / 出力圧縮 / 分割)のどれが必要か判断できない。
 *
 * **数値と設定値のみ。** raw response 本文・candidate text・prompt 本文・URL は出さない
 * (`logGeminiCallFailure` と同じ規約)。
 */
function logMaxTokens(stage: "stage1" | "stage2", usage: UsageMetadataLike | null): void {
  console.error("[research.gemini] max_tokens", {
    stage,
    configured_max_output_tokens: getResearchMaxOutputTokens(),
    prompt_token_count: usage?.promptTokenCount ?? null,
    thoughts_token_count: usage?.thoughtsTokenCount ?? null,
    candidates_token_count: usage?.candidatesTokenCount ?? null,
    tool_use_prompt_token_count: usage?.toolUsePromptTokenCount ?? null,
    total_token_count: usage?.totalTokenCount ?? null,
  });
}

/**
 * SDK 生エラーを正規化しつつ、失敗を sanitized にログへ残す。
 * 正規化後の `AiClientError` の内容は従来と一切変わらない(分類ロジックは無変更)。
 */
function normalizeAndLog(
  stage: "stage1" | "stage2",
  err: unknown,
  requestDiagnostics?: RequestDiagnostics,
): AiClientError {
  const normalized = normalizeSdkError(err);
  logGeminiCallFailure(stage, err, normalized.kind, requestDiagnostics);
  return normalized;
}

export function createResearchGeminiClient(): ResearchGeminiClient {
  return {
    async runSourceDiscovery(prompt, signal) {
      const apiKey = readEnv("GEMINI_API_KEY");
      if (!apiKey) throw makeError({ kind: "missing_api_key" });

      const model = getResearchGeminiModel();
      const ai = new GoogleGenAI({ apiKey });

      try {
        const response = await ai.models.generateContent({
          model,
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          config: {
            tools: [{ googleSearch: {} }],
            // Search診断情報(searchCallCount/searchQueryCount)取得のため有効化。
            // groundingMetadataの代替source of truthにはしない(あくまで診断用)。
            toolConfig: { includeServerSideToolInvocations: true },
            maxOutputTokens: getResearchMaxOutputTokens(),
            abortSignal: signal,
          },
        });

        const text = response.text;
        if (typeof text !== "string" || text.length === 0) {
          throw makeError({ kind: "unknown", message: "Source Discovery の応答が空でした" });
        }

        const candidate = response.candidates?.[0];
        const { searchCallCount, searchQueryCount, tabelogSearchAttempted } =
          extractSearchDiagnostics(candidate?.content?.parts);

        return {
          text,
          groundingMetadata: (candidate?.groundingMetadata as GroundingMetadataLike | undefined) ?? null,
          usageMetadata: extractUsageMetadata(response.usageMetadata),
          searchCallCount,
          searchQueryCount,
          tabelogSearchAttempted,
        };
      } catch (err) {
        throw normalizeAndLog("stage1", err);
      }
    },

    async runStructuredUrlContext({ prompt, jsonSchema, diagnostics }, signal) {
      const apiKey = readEnv("GEMINI_API_KEY");
      if (!apiKey) throw makeError({ kind: "missing_api_key" });

      const model = getResearchGeminiModel();
      const ai = new GoogleGenAI({ apiKey });

      try {
        const response = await ai.models.generateContent({
          model,
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          config: {
            tools: [{ urlContext: {} }],
            responseMimeType: "application/json",
            responseJsonSchema: jsonSchema,
            maxOutputTokens: getResearchMaxOutputTokens(),
            abortSignal: signal,
          },
        });

        const candidate = response.candidates?.[0];

        // 長さ上限による打ち切りを、空応答/JSON parse失敗より先に専用分類へ落とす。
        // Gemini 3系はthinkingが既定で有効で、thinking tokenも出力枠(maxOutputTokens)を
        // 消費するため、41項目Combinedの出力途中でJSON が閉じられないまま打ち切られうる
        // (実機smoke testで thoughtsTokenCount+candidatesTokenCount が上限に到達し、
        // 後続のJSON.parseが構文エラーになる事象を確認済み)。ここで検出しないと
        // 「JSON parse failure」と「出力token上限」が区別できなくなる。
        if (candidate?.finishReason === FinishReason.MAX_TOKENS) {
          // feat/ai-research-quality-ux-hardening(Theme 5B): この時点では
          // `response.usageMetadata` がスコープ内にあり、thinking と candidates の
          // どちらが枠を食い潰したかを**数値だけ**取り出せる。従来はここで読まずに
          // throw していたため `token_usage = null` になり、対策の効果測定ができなかった。
          const usage = extractUsageMetadata(response.usageMetadata);
          logMaxTokens("stage2", usage);
          throw makeError({ kind: "max_tokens", usage: usage ?? undefined });
        }

        const rawText = response.text;
        if (typeof rawText !== "string" || rawText.length === 0) {
          throw makeError({ kind: "unknown", message: "Stage2 の応答が空でした" });
        }

        const ucm = candidate?.urlContextMetadata as
          | { urlMetadata?: { retrievedUrl?: string | null; urlRetrievalStatus?: string | null }[] }
          | undefined;

        return {
          rawText,
          urlContextMetadata: ucm
            ? {
                urlMetadata: (ucm.urlMetadata ?? []).map((u) => ({
                  retrievedUrl: u.retrievedUrl ?? null,
                  status: u.urlRetrievalStatus ?? null,
                })),
              }
            : null,
          usageMetadata: extractUsageMetadata(response.usageMetadata),
        };
      } catch (err) {
        // prompt は**一切変更せず**、失敗時にだけ性質を count / boolean で観測する(PR #180)。
        // 成功パスでは評価すらしない(失敗時のみのコスト)。
        //
        // `diagnostics` は呼び出し側(`runStage2`)が構造化入力(allowedKeys /
        // sourceRegistry / searchNotes)から組み立てたもの。ここで prompt 本文から
        // 逆算するのは prompt の文字数関連だけに留める(構造化入力がある値を
        // テキスト解析で再導出しない)。
        throw normalizeAndLog("stage2", err, {
          ...(diagnostics ?? {}),
          prompt_char_count: prompt.length,
          prompt_utf8_byte_count: new TextEncoder().encode(prompt).length,
          has_control_chars: hasControlChars(prompt),
          prompt_has_unpaired_surrogate: hasUnpairedSurrogate(prompt),
        });
      }
    },
  };
}

export type { AiClientError };
export { isAiClientError } from "@/lib/ai/client";
