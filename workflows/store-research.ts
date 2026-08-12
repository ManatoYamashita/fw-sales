/**
 * AI 店舗調査の Vercel Workflow 定義(AI 店舗調査再設計 Plan v3.2 §16, PR3、
 * fix/ai-research-poc-like-retrieval で Stage0/known_store_data 追加・Stage2統合・
 * Stage1.5撤去・quality warning追加)。
 *
 * fw-sales の実際の Vercel Team は Hobby プランであることを確認済み。Hobby でも
 * Fluid Compute・Vercel Workflows は利用可能。個別 Function の実行時間上限(300秒)を
 * 踏まえ、各 Gemini 呼び出し・各 Web リクエストを個別の Workflow step へ分割することで、
 * パイプライン全体を1つの Function 呼び出しに収める必要がない設計にしている(Plan §16)。
 *
 * ## fix/ai-research-poc-like-retrieval での変更点(Spike 0.2/0.3の実証結果を反映)
 *
 * 旧設計は「公式groundingMetadataのみをSource of Truthにする」という方針だったが、
 * 実機検証の結果 groundingMetadata が恒常的に欠落することが判明し、Source Registry が
 * 常に0件になり53項目のほぼ全てが not_found に陥る品質劣化を引き起こしていた。
 * 本改訂では以下へ転換する:
 *
 * - Stage1: モデル自由記述の `[SOURCE]` 候補URLもSource Registryへ登録する
 *   (`discovery_provenance: "gemini_search_candidate"`、`lib/ai/research/source-registry.ts`)。
 *   confirmedの根拠にできるかは、引き続きStage2 URL Context取得成功の有無で判定される
 *   (`applyDeterministicValidation` のロジックは変更していない)。
 * - Stage0(新設): `stores.google_place_id` がある場合のみ Place Details を1回取得し、
 *   in-memoryでのみ `placesVerifiedKeys` を強化する(DB書き込みなし、manual値上書きなし)。
 * - known_store_data(新設): `stores.site_url`/`stores.instagram_url` をSource Registryへ
 *   直接seedする(Geminiの発見に依存しない)。
 * - Stage1.5(grounding redirect URL resolver)は本Workflowのクリティカルパスから撤去。
 *   `lib/ai/research/source-url-resolver.ts` 自体は削除せず残置する(他用途での再利用可能性)。
 * - Stage2はFACT/ANALYSISの2並列callから、PoCと同様の単一callへ統合。
 *   1 runあたりGemini呼出は原則Stage1 1回・Stage2 1回の合計2回。
 * - Source Registry 0件、またはURL Context取得成功が0件の場合、run自体はsucceededの
 *   ままだが `warnings` へ明示的な文言を追加する(silent successにしない)。
 *
 * ## retry方針(Plan v3.2 §17、確定、変更なし)
 *
 * - auth / 400 / invalid schema → retry 0(`FatalError`)
 * - 429 / 503 / network timeout → 最大1 retry(step の `maxRetries = 1` + `RetryableError`)
 * - その他 → 安全側に倒し `FatalError`(無闇な自動retryをしない)
 *
 * Source Registry 0件だからといってStage1を自動で何度も再検索する実装にはしない
 * (既存retry policy(429/503/timeout/network)のみを維持する)。
 *
 * ## idempotency(Plan v3.2 §17、変更なし)
 *
 * Gemini API 自体はidempotency keyをサポートしないため、各 Gemini 呼び出しstepは
 * 「呼び出して結果を返すだけ」に責務を絞り、DB書き込み等の副作用を同じstep内に
 * 混在させない。
 *
 * 関連: Plan v3.2 §8, §16, §17
 */

import { FatalError, RetryableError } from "workflow";
import { repos } from "@/lib/repositories";
import {
  runStage1,
  runStage2,
  buildNonAiItems,
  buildDeterministicItems,
  applyUrlContextStatus,
  applySourceIdentityVerification,
  upgradeMediaCoverageFromRegistry,
  appendConfirmedMediaContext,
  finalizeResearchItems,
  Stage2InvalidOutputError,
} from "@/lib/ai/research/pipeline";
import {
  buildKnownStoreDataEntries,
  buildKnownStoreDataUrls,
  mergeKnownStoreDataIntoRegistry,
} from "@/lib/ai/research/source-registry";
import { runStage0PlacesResync, type Stage0PlacesResult } from "@/lib/ai/research/places-stage0";
import { resolveOfficialAliases } from "@/lib/ai/research/official-alias";
import {
  GEMINI_STAGE_TIMEOUT_MS,
  GEMINI_STAGE_MAX_RETRIES,
  GEMINI_RETRY_AFTER_MS,
  STAGE0_MAX_RETRIES,
  STAGE0_PLACES_TIMEOUT_MS,
  RETRYABLE_SANITIZED_KINDS,
  type RetryableSanitizedKind,
  DB_STEP_MAX_RETRIES,
} from "@/lib/ai/research/run-timing";
import { isAiClientError } from "@/lib/ai/client";
import type { StoreIdentity } from "@/lib/ai/research/prompts";
import type { SourceRegistryEntry, ResearchItem, SearchFact } from "@/lib/ai/research-result-schema";
import {
  sortResearchItemsToCanonicalOrder,
  validateFinalResearchResultIntegrity,
} from "@/lib/ai/research-result-schema";
import type { SearchNote } from "@/lib/ai/research/source-registry";
import type { UsageMetadataLike } from "@/lib/ai/research/client";
import type { BasicInfo } from "@/types/basic-info";
import { nowIso } from "@/lib/utils/date";

/**
 * timeout / retry 構成は `lib/ai/research/run-timing.ts` を唯一のSource of Truthとする
 * (fix: PR #180 review Finding 3)。ここで独自にハードコードすると、
 * `getResearchRunExpiresMarginMinutes()` の安全下限計算との drift が発生し、
 * 正常runがstuck誤判定される不具合が再発する。
 */
const STAGE_TIMEOUT_MS = GEMINI_STAGE_TIMEOUT_MS;

/**
 * `classifyForWorkflowRetry` が `FatalError`/`RetryableError` のメッセージへ埋め込む
 * sanitized kind トークンの正規表現(`deriveErrorKind` 側の抽出と対になる)。
 *
 * PR #187 で修正済み: `api_error` のみ `api_error:<status>` の形で HTTP status を保持する。
 * ここに載せてよいのは正規化済みの kind と HTTP status のみで、SDK の生メッセージ・
 * request ID・API key は一切含めない。この観測性・503 retry の修正は本PRでも維持する。
 *
 * runtime hardening(実機Preview検証、2026-08-07): `stage2_invalid_output` は
 * `Stage2InvalidOutputKind`(`json_parse`/`schema`/`coverage`/`identity`)を
 * `stage2_invalid_output:<kind>` の形で追加できるよう拡張した。旧来の裸の
 * `stage2_invalid_output`(kind不明時のフォールバック)も後方互換のため許容する。
 */
const SANITIZED_KIND_PATTERN =
  /\((auth_error|missing_api_key|rate_limit|timeout|network_error|max_tokens|api_error:\d{3}|stage2_invalid_output(?::(?:json_parse|schema|coverage|identity))?|final_result_invalid|unknown)\)/;

/**
 * `classifyForWorkflowRetry` が `RetryableError` のメッセージに使う定型文プレフィックス。
 * **生成(`retryableMessage`)と検出(`RETRY_EXHAUSTED_PATTERN`)の両方でこの定数を使う**ため、
 * 片方だけを書き換えて drift させることができない。
 */
const RETRYABLE_MESSAGE_PREFIX = "Gemini呼出が一時的に失敗しました";

function retryableMessage(token: RetryableSanitizedKind): string {
  return `${RETRYABLE_MESSAGE_PREFIX}(${token})。1回だけ再試行します。`;
}

/**
 * 「Workflow SDK が retry exhaustion 後に wrap した」ことを判定する正規表現。
 *
 * ## なぜ token 単体ではなく自前テンプレートに anchor するのか
 *
 * SDK は retry 上限に達した step の元エラーを新しい `FatalError` でラップし、その message は
 * `Step "<name>" failed after N retry: <元message>` になる。ここで **DB step
 * (`loadStoreStep` / `markStageStep` / `persist*Step` / `markFailedStep`) は
 * `classifyForWorkflowRetry` を通さない**ため、Postgres/Neon の生メッセージがそのまま
 * `<元message>` に入りうる。
 *
 * token だけを message 全体から探すと、生メッセージが偶然 `(timeout)` 等を含んだだけで
 * 「Gemini の一過性エラーを retry したが力尽きた」と誤ラベルしてしまう。そこで
 * **我々が生成した RetryableError の定型文ごと**一致した場合のみ retry exhaustion と判定する。
 *
 * この設計は SDK の英語 wrapper prefix にも `err.cause` の serialize 挙動にも依存しない
 * (どちらも SDK 実装詳細であり、バージョン更新で変わりうるため)。
 */
const RETRY_EXHAUSTED_PATTERN = new RegExp(
  `${RETRYABLE_MESSAGE_PREFIX}\\((${RETRYABLE_SANITIZED_KINDS.join("|")})\\)`,
);

/**
 * 失敗時に `store_research_runs` へ永続化する sanitized なフィールド。
 *
 * `error_message` に **raw なエラー内容を一切保存しない**(監査指摘 3)。理由は 2 つ:
 * 1. DB step の失敗では SDK wrapper 経由で Postgres/Neon の生メッセージ(接続先ホスト・
 *    ロール名等を含みうる)が入る経路があった。
 * 2. research detail page は `StoreResearchRun[]` を Client Component へ渡すため、
 *    UI で非表示でも `error_message` は RSC payload としてブラウザへ送られる。
 *
 * 診断の Source of Truth は `error_kind`(sanitized token)と Vercel structured log が担う。
 */
const FAILED_RUN_MESSAGE = "AI店舗調査に失敗しました";

export function buildFailureRecord(err: unknown): { error_kind: string; error_message: string } {
  return { error_kind: deriveErrorKind(err), error_message: FAILED_RUN_MESSAGE };
}

/**
 * 失敗時に保存する `token_usage`(feat/ai-research-quality-ux-hardening、Theme 5B)。
 *
 * 実機の MAX_TOKENS run では `token_usage = null` だった。原因は 2 つ:
 * 1. `client.ts` が `usageMetadata` を読まずに throw していた(修正済み)
 * 2. `markFailedStep` の patch に `token_usage` が含まれていなかった(本関数で対応)
 *
 * 副次被害として、Stage2 が落ちると **Stage1 の usage まで丸ごと消えていた**
 * (`token_usage` を書くのは `persistSucceededStep` の1箇所だけだったため)。
 * ここで Stage1 分も一緒に保存する。
 *
 * **数値のみ。** raw message / response body は絶対に含めない。
 * `store_research_runs.token_usage` は jsonb なので **migration 不要**。
 *
 * @returns 保存すべき内容が無ければ `null`(patch に含めず既存値を維持する)
 */
export function extractFailureTokenUsage(
  err: unknown,
  stage1Usage: UsageMetadataLike | null,
): Record<string, unknown> | null {
  const usage: Record<string, unknown> = {};
  if (stage1Usage !== null) usage.stage1 = stage1Usage;
  // `stage2` に入るのは `readMaxTokensFailureCause` の厳格な shape guard を
  // 通過した数値のみ(成功パスの `stage2_combined` と同じフィールド命名)。
  const stage2 = readMaxTokensFailureCause(err);
  if (stage2 !== null) usage.stage2 = stage2;
  return Object.keys(usage).length > 0 ? usage : null;
}

/**
 * `Error` へ `cause` を後付けする(`FatalError` の constructor が options を
 * 受け取らないため)。SDK の serialization は `cause` を `BaseErrorPayload` に
 * 含めるので、step 境界を越えて残る唯一の追加チャネルになる。
 */
function withCause<E extends Error>(error: E, cause: unknown): E {
  error.cause = cause;
  return error;
}

/**
 * MAX_TOKENS 時に `FatalError.cause` へ載せる sanitized payload の判別子。
 * plain object の構造だけで識別し、class identity / prototype には依存しない。
 */
const MAX_TOKENS_CAUSE_KIND = "max_tokens_usage";

/**
 * cause に載せてよい token 数フィールドの allowlist。
 * `UsageMetadataLike`(`lib/ai/research/client.ts`)と同じ命名にそろえ、
 * DB の `token_usage.stage1` / 成功パスの `stage2_combined` と比較可能にする。
 */
const MAX_TOKENS_USAGE_FIELDS = [
  "promptTokenCount",
  "candidatesTokenCount",
  "toolUsePromptTokenCount",
  "thoughtsTokenCount",
  "totalTokenCount",
] as const;

type MaxTokensUsageField = (typeof MAX_TOKENS_USAGE_FIELDS)[number];
type SanitizedTokenUsage = Partial<Record<MaxTokensUsageField, number | null>>;

/**
 * `FatalError.cause` へ載せる **完全に sanitized な plain object**
 * (feat/ai-research-quality-ux-hardening、最終レビュー指摘)。
 *
 * 数値(と null)だけを持つ。raw response / provider message / prompt / URL /
 * headers / request ID は一切含まない。`AiClientError` そのものは載せない。
 */
export interface MaxTokensFailureCause {
  kind: typeof MAX_TOKENS_CAUSE_KIND;
  usage: SanitizedTokenUsage;
}

/** 値が「数値(有限)または null」であること。`NaN`/`Infinity`/文字列は拒否。 */
function isUsageValue(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

/**
 * `AiClientError.usage` から cause 用の sanitized payload を組み立てる。
 * allowlist 外のキーは**落とし**、数値でない値を持つキーも落とす。
 * 1つも載せる値が無ければ `null`(cause を付けない)。
 */
function buildMaxTokensFailureCause(usage: unknown): MaxTokensFailureCause | null {
  if (typeof usage !== "object" || usage === null) return null;
  const source = usage as Record<string, unknown>;
  const sanitized: SanitizedTokenUsage = {};
  for (const field of MAX_TOKENS_USAGE_FIELDS) {
    const value = source[field];
    if (isUsageValue(value)) sanitized[field] = value;
  }
  return Object.keys(sanitized).length > 0
    ? { kind: MAX_TOKENS_CAUSE_KIND, usage: sanitized }
    : null;
}

/**
 * `err.cause` が MAX_TOKENS の sanitized payload かを**厳格に**判定して取り出す。
 *
 * Workflow の catch が受け取るのは `stage2Step` が投げた **`FatalError`** であり、
 * 元の `AiClientError` ではない(`classifyForWorkflowRetry` が変換する)。
 * SDK の serialization は `FatalError` / generic `Error` のいずれも
 * `{ (name,) message, stack, cause }` しか保持しないため、`cause` が唯一の伝播経路。
 *
 * 受け入れ条件(すべて構造のみ。**prototype / class identity は見ない**):
 * - plain object(配列でない)
 * - `kind === "max_tokens_usage"`
 * - `usage` が plain object(配列でない)
 * - `usage` の **全ての own key が allowlist に含まれ**、値が数値(有限)か null
 *
 * 1つでも外れたら **payload 全体を拒否**する(部分採用しない)。
 * 拒否時は `token_usage` から `stage2` を省略するだけで、
 * `error_kind` の正しさには影響しない(safe degrade)。
 *
 * 探索は `err.cause` の **1段のみ**。深く辿ると SDK の retry-exhaustion wrapper 等を
 * 巻き込み、意図しない値を拾う余地が増えるため。
 */
function readMaxTokensFailureCause(err: unknown): SanitizedTokenUsage | null {
  const cause = (err as { cause?: unknown } | null | undefined)?.cause;
  if (typeof cause !== "object" || cause === null || Array.isArray(cause)) return null;

  const record = cause as Record<string, unknown>;
  if (record.kind !== MAX_TOKENS_CAUSE_KIND) return null;

  const usage = record.usage;
  if (typeof usage !== "object" || usage === null || Array.isArray(usage)) return null;

  const allowed = new Set<string>(MAX_TOKENS_USAGE_FIELDS);
  const entries = Object.entries(usage as Record<string, unknown>);
  if (entries.length === 0) return null;

  const sanitized: SanitizedTokenUsage = {};
  for (const [key, value] of entries) {
    // 未知キー・非数値が1つでもあれば payload 全体を拒否する(部分採用しない)。
    if (!allowed.has(key) || !isUsageValue(value)) return null;
    sanitized[key as MaxTokensUsageField] = value;
  }
  return sanitized;
}

/**
 * `AiClientError` を Workflow の retry 意味論(`FatalError` / `RetryableError`)へ変換する。
 * 純関数としてexportし、単体テストで直接検証する。PR #187 の修正内容を維持している
 * (絶対に壊さない): 503 (service unavailable) は 429 / timeout / network_error と同じ
 * 「最大1 retry」対象。`api_error` の他ステータス(400/404/500 等)は安全側に倒しretryしない。
 *
 * retryAfter(実機Preview検証、2026-08-07): 全種一律5sだったものを、種別ごとの典型的な
 * 回復特性に合わせて調整した。maxRetries=1(2 attempts)自体は変更しない(3回以上への
 * 安易な引き上げはしない方針)。429(rate_limit)はレスポンス自体が即座に返るため待機を
 * 伸ばしてもtotal所要時間への影響が小さく30s、503は「過負荷は通常数分で解消する」という
 * Gemini公式ガイドを踏まえ20s、timeout/network_errorは一過性の接続断が主因のため10s。
 *
 * これらの実値は`lib/ai/research/run-timing.ts`の`GEMINI_RETRY_AFTER_MS`が保持する
 * (fix: PR #180 review Finding 3)。同モジュールが`MAX_GEMINI_RETRY_AFTER_MS`を導出し、
 * `getResearchRunExpiresMarginMinutes()`の安全下限計算へ反映するため、ここで値を
 * 変更しても expires margin が自動的に追従する(旧実装のようにretryAfterを伸ばした結果
 * 既定マージンを超過する、という drift が起きない)。
 */
export function classifyForWorkflowRetry(err: unknown): Error {
  if (err instanceof Stage2InvalidOutputError) {
    // Stage2の応答がJSON parse/schema/coverage/identityのいずれかで失敗した場合(BLOCKER1)。
    // 自動的なGemini再callは追加しない(ユーザーが再調査を選べればよい)ため retry 0。
    // kindをsanitized tokenへ埋め込むことで、error_kindだけで4分類を判別できるようにする。
    return new FatalError(`Stage2の応答検証に失敗しました(stage2_invalid_output:${err.kind})`);
  }
  if (isAiClientError(err)) {
    switch (err.kind) {
      case "rate_limit":
        return new RetryableError(retryableMessage("rate_limit"), {
          retryAfter: GEMINI_RETRY_AFTER_MS.rate_limit,
        });
      case "timeout":
        return new RetryableError(retryableMessage("timeout"), {
          retryAfter: GEMINI_RETRY_AFTER_MS.timeout,
        });
      case "network_error":
        return new RetryableError(retryableMessage("network_error"), {
          retryAfter: GEMINI_RETRY_AFTER_MS.network_error,
        });
      case "missing_api_key":
      case "auth_error":
        return new FatalError(`Gemini呼出が認証エラーで失敗しました(${err.kind})`);
      case "api_error": {
        if (err.status === 503) {
          return new RetryableError(retryableMessage("api_error:503"), {
            retryAfter: GEMINI_RETRY_AFTER_MS.service_unavailable,
          });
        }
        return new FatalError(`Gemini呼出が失敗しました(api_error:${err.status})`);
      }
      case "max_tokens": {
        // Theme 5B: token 内訳を `cause` に載せて Workflow の catch まで運ぶ。
        //
        // **`FatalError` の独自プロパティは step 境界を越えられない。** SDK の
        // serialization reducer(`@workflow/core` dist の
        // `serialization/reducers/common.js`)は `FatalError` を
        // `makeErrorSubclassReducer('FatalError')` で扱い、保持されるのは
        // `BaseErrorPayload = { message, stack, cause? }` **のみ**。
        // したがって `new FatalError(msg)` に `usage` を生やしても失われる。
        // `cause` は同 payload に含まれるため、ここだけを伝播経路に使う。
        //
        // **`cause` には `AiClientError` そのものを入れない**(最終レビュー指摘):
        // 同 reducer 群の generic `Error` reducer(`:239-250`)も
        // `{ name, message, stack, cause }` しか保存しないため、`cause` が
        // native Error だった場合は独自プロパティが再帰的に失われる。
        // 現状の `AiClientError` は plain object なのでたまたま生き残るが、
        // それは「`AiClientError` が Error subclass ではない」という**偶然**に
        // 依存した設計であり、将来 Error 化されると usage が無言で消える。
        //
        // そこで **専用の sanitized plain object** を cause に載せる。
        // 中身は数値(と null)だけで、raw response / provider message / prompt /
        // URL / headers / request ID は一切含まない。
        //
        // `deriveErrorKind` は従来どおり **message のみ**を見るため、分類ロジックは
        // `cause` に一切依存しない(cause が失われても error_kind は
        // `fatal:max_tokens` のままで、usage が欠けるだけの safe degrade)。
        //
        // `FatalError` の constructor は `message` しか受け取らない
        // (`@workflow/errors` dist で確認済み。`super(message)` のみ)ため、
        // `cause` は **生成後に代入する**。SDK 自身の retry-exhaustion wrapper も
        // 同じ方法を採っている(`step-executor.js` の `wrappedError.cause = err`)。
        const fatal = new FatalError(`Gemini呼出が失敗しました(${err.kind})`);
        const cause = buildMaxTokensFailureCause(err.usage);
        return cause === null ? fatal : withCause(fatal, cause);
      }
      case "unknown":
      default:
        return new FatalError(`Gemini呼出が失敗しました(${err.kind})`);
    }
  }
  // 非 AiClientError(Gemini stage 内で起きた想定外の例外)。
  //
  // **raw `err.message` を引き継がない**(runtime reliability hardening)。旧実装は
  // `new FatalError(err.message)` としていたため、(a) 外部由来テキストが `error_message`
  // として DB へ入りうる、(b) `deriveErrorKind` が「FatalError 内の retryable token =
  // SDK による retry exhaustion wrap」と判定する際に、raw message に偶然
  // `(rate_limit)` 等が含まれていると誤分類する、という 2 つの問題があった。
  //
  // sanitized な固定文言にすることで、`classifyForWorkflowRetry` が生成する FatalError の
  // message は全て既知の定型文だけになり、`RETRYABLE_SANITIZED_KINDS` を使った
  // retry exhaustion 判定の不変条件が成立する(`run-timing.ts` の JSDoc 参照)。
  // 診断に必要な情報は `lib/ai/research/client.ts` が sanitized structured log として出す。
  return new FatalError("Gemini呼出が失敗しました(unknown)");
}

/**
 * エラーオブジェクトから `store_research_runs.error_kind` へ書き込む短い文字列を導出する。
 * PR #187 の修正内容を維持している(絶対に壊さない)。
 *
 * `instanceof` ではなく `FatalError.is()`/`RetryableError.is()` を使う(実機Preview検証、
 * 2026-08-07): `workflow` SDK公式ドキュメントが「cross-realm(workflow VM境界・retry時の
 * 別実行コンテキスト)では `instanceof` が失敗しうるため `.is()` を使うこと」と明記している
 * (`node_modules/workflow/docs/api-reference/workflow/fatal-error.mdx`)。`.is()` は
 * `name`プロパティ一致(`FatalError`は加えて`fatal:true`のduck typingも)で判定するため、
 * step再実行時にシリアライズ/デシリアライズを経てもクラス識別が保たれる。
 */
export function deriveErrorKind(err: unknown): string {
  if (FatalError.is(err)) {
    // Workflow SDK は retry 上限に達した step の元エラーを**新しい FatalError でラップ**する
    // (`@workflow/core` dist/runtime/step-executor.js:786-794)。そのため我々が投げた
    // `RetryableError` も workflow の catch には `FatalError` として届き、旧実装では
    // 「retryしたが力尽きた」情報が失われて全て `fatal:*` に潰れていた
    // (実障害の観測値 `fatal:rate_limit` がこの経路の証拠)。
    //
    // 判定は `RETRY_EXHAUSTED_PATTERN`(自前定型文への anchor)で行う。token 単体で探すと、
    // `classifyForWorkflowRetry` を通さない DB step の raw message が偶然 `(timeout)` 等を
    // 含んだだけで誤ラベルされる(同 pattern の JSDoc 参照)。
    const exhausted = err.message.match(RETRY_EXHAUSTED_PATTERN);
    if (exhausted?.[1] !== undefined) return `retryable_exhausted:${exhausted[1]}`;

    const match = err.message.match(SANITIZED_KIND_PATTERN);
    return match?.[1] !== undefined ? `fatal:${match[1]}` : "fatal";
  }
  if (RetryableError.is(err)) {
    const match = err.message.match(SANITIZED_KIND_PATTERN);
    return match?.[1] !== undefined ? `retryable_exhausted:${match[1]}` : "retryable_exhausted";
  }
  if (isAiClientError(err)) {
    return err.kind === "api_error" ? `api_error:${err.status}` : err.kind;
  }
  return "unknown";
}

/* ------------------------------------------------------------------ */
/*  Steps                                                              */
/* ------------------------------------------------------------------ */

interface LoadedStore {
  store: StoreIdentity;
  basicInfo: BasicInfo;
  googlePlaceId: string | null;
  knownStoreDataUrls: ReturnType<typeof buildKnownStoreDataUrls>;
}

async function loadStoreStep(storeId: string): Promise<LoadedStore> {
  "use step";
  const store = await repos.store.get(storeId);
  if (!store) {
    throw new FatalError(`店舗が見つかりません: ${storeId}`);
  }
  return {
    store: {
      name: store.name,
      address: store.address,
      phone: store.phone,
      genre: store.genre,
    },
    basicInfo: store.basic_info,
    googlePlaceId: store.google_place_id,
    knownStoreDataUrls: buildKnownStoreDataUrls(store),
  };
}
loadStoreStep.maxRetries = DB_STEP_MAX_RETRIES;

async function markStageStep(
  runId: string,
  stage: "discovering" | "researching" | "done",
): Promise<void> {
  "use step";
  await repos.researchRun.update(runId, { stage });
}
markStageStep.maxRetries = DB_STEP_MAX_RETRIES;

/**
 * Stage0: Google Places 軽量再同期(best-effort)。`google_place_id` が有れば Place Details を、
 * 無ければ Text Search fallback(strong matchのみ採用)を試みる
 * (feat/ai-research-quality-refinement)。失敗してもWorkflow全体をfailedにしない
 * (`maxRetries = 0`、warningのみ記録)。
 */
async function stage0PlacesStep(
  googlePlaceId: string | null,
  store: StoreIdentity,
): Promise<Stage0PlacesResult> {
  "use step";
  return runStage0PlacesResync({
    googlePlaceId,
    store,
    now: nowIso(),
    timeoutMs: STAGE0_PLACES_TIMEOUT_MS,
  });
}
stage0PlacesStep.maxRetries = STAGE0_MAX_RETRIES;

async function stage1Step(store: StoreIdentity) {
  "use step";
  try {
    return await runStage1(store, AbortSignal.timeout(STAGE_TIMEOUT_MS));
  } catch (err) {
    throw classifyForWorkflowRetry(err);
  }
}
stage1Step.maxRetries = GEMINI_STAGE_MAX_RETRIES;

/**
 * known official URL の alias 解決 + Source Registry の永続化。
 *
 * ## なぜ alias 解決を専用 step にせず、この step に同居させるのか
 *
 * 新しい step を足すと `run-timing.ts` の safe expiry budget
 * (`SCHEDULING_BUDGET_PER_ATTEMPT_MS` + step timeout)が増え、
 * `MIN_SAFE_EXPIRES_MARGIN_MINUTES` が 30 → 31 分へ動く。この 30 分は
 * 既存の不変条件(`workflows/__tests__/store-research.test.ts` が `toBe(30)` で固定)
 * であり、品質改善のために動かす必然性が無い。
 *
 * alias 解決は Stage1 と Stage2 の間、まさにこの step の位置で必要になる処理であり、
 * HEAD リクエストのみ・並列実行・全体 8s 上限のため
 * `DB_STEP_BUDGET_MS = 15_000` の見積内に収まる。
 * → `GEMINI_STAGE_COUNT` / `DB_STEP_COUNT` / budget 定数はいずれも変更しない。
 *
 * best-effort。resolver が全滅しても registry はそのまま Stage2 へ進む。
 */
async function resolveAndPersistSourceRegistryStep(
  runId: string,
  sourceRegistry: SourceRegistryEntry[],
  knownOfficialUrls: string[],
): Promise<SourceRegistryEntry[]> {
  "use step";
  const aliased = await resolveOfficialAliases({
    registry: sourceRegistry,
    knownOfficialUrls,
  });
  // 失敗理由の内訳まで残す(PR #180 final smoke hardening、Issue A)。
  // 実機では `attempted: 8 / merged: 0` しか出ておらず、timeout / DNS / IP 拒否の
  // どれなのかを切り分けられなかった。出すのは allowlist 済みの reason token と
  // その件数だけで、URL・redirect token・生エラーメッセージは含めない。
  console.info("[research.alias] official alias resolve", {
    runId,
    attempted: aliased.attempted,
    merged: aliased.merged,
    skipped_unsupported_host: aliased.skippedUnsupportedHost,
    failures: aliased.failures,
  });
  await repos.researchRun.update(runId, { source_registry: aliased.registry });
  return aliased.registry;
}
resolveAndPersistSourceRegistryStep.maxRetries = DB_STEP_MAX_RETRIES;

/**
 * Stage2: AI対象項目(FACT + FACT_OR_HEARING + ANALYSIS)を1回のGemini呼出で生成する
 * (fix/ai-research-poc-like-retrieval、PoCと同様の単一call構成)。
 */
async function stage2Step(
  store: StoreIdentity,
  sourceRegistry: SourceRegistryEntry[],
  searchNotes: SearchNote[],
  excludeKeys: string[],
) {
  "use step";
  try {
    return await runStage2(
      { store, sourceRegistry, searchNotes, excludeKeys: new Set(excludeKeys) },
      AbortSignal.timeout(STAGE_TIMEOUT_MS),
    );
  } catch (err) {
    throw classifyForWorkflowRetry(err);
  }
}
stage2Step.maxRetries = GEMINI_STAGE_MAX_RETRIES;

interface FinalizeStepParams {
  items: ResearchItem[];
  sourceRegistry: SourceRegistryEntry[];
  tokenUsage: Record<string, unknown>;
  warnings: string[];
}

async function persistSucceededStep(runId: string, params: FinalizeStepParams): Promise<void> {
  "use step";
  await repos.researchRun.update(runId, {
    status: "succeeded",
    stage: "done",
    result: params.items,
    source_registry: params.sourceRegistry,
    token_usage: params.tokenUsage,
    warnings: params.warnings,
    finished_at: nowIso(),
  });
}
persistSucceededStep.maxRetries = DB_STEP_MAX_RETRIES;

async function markFailedStep(
  runId: string,
  err: unknown,
  stage1Usage: UsageMetadataLike | null = null,
): Promise<void> {
  "use step";
  // `error_message` は固定文言のみ。raw なエラー内容は DB へ保存しない
  // (`buildFailureRecord` の JSDoc 参照、監査指摘 3)。
  const failure = buildFailureRecord(err);
  // 失敗を Vercel Function logs にも残す(runtime reliability hardening、F3)。
  // 従来 `workflows/` と `lib/ai/` には console 出力が1つも無く、run 失敗の診断には
  // Supabase を直接開いて `store_research_runs` を見るしかなかった。
  //
  // 出してよいのは sanitized scalar のみ。err オブジェクト・raw message・API key・
  // request ID・レスポンス本文は渡さない(Gemini 呼出単位のより詳細な診断は
  // `lib/ai/research/client.ts` 側の log が担当する)。
  console.error("[research.workflow] run failed", {
    runId,
    error_kind: failure.error_kind,
    retry_exhausted: failure.error_kind.startsWith("retryable_exhausted"),
  });
  // Theme 5B: 失敗時も token 内訳を残す(取得できていない場合は patch に含めない)。
  const tokenUsage = extractFailureTokenUsage(err, stage1Usage);
  await repos.researchRun.update(runId, {
    status: "failed",
    ...failure,
    ...(tokenUsage === null ? {} : { token_usage: tokenUsage }),
    finished_at: nowIso(),
  });
}
markFailedStep.maxRetries = DB_STEP_MAX_RETRIES;

/* ------------------------------------------------------------------ */
/*  Workflow                                                            */
/* ------------------------------------------------------------------ */

export interface StoreResearchWorkflowResult {
  runId: string;
  status: "succeeded" | "failed";
}

/**
 * AI 店舗調査の Workflow 本体。`start(storeResearchWorkflow, [runId, storeId])` で起動する
 * (トリガーは `lib/actions/research-run-actions.ts`)。
 *
 * 1 runあたりのGemini API呼出は原則2回(Stage1 1回・Stage2 1回)。
 * Google Places API呼出は `google_place_id` が存在する場合のみ最大1回(Stage0)。
 * それ以外の外部検索APIは呼ばない。
 */
export async function storeResearchWorkflow(
  runId: string,
  storeId: string,
): Promise<StoreResearchWorkflowResult> {
  "use workflow";

  // Stage2 が失敗しても Stage1 の usage を失わないよう、try の外側で保持する
  // (feat/ai-research-quality-ux-hardening、Theme 5B)。
  let stage1Usage: UsageMetadataLike | null = null;

  try {
    const { store, basicInfo, googlePlaceId, knownStoreDataUrls } = await loadStoreStep(storeId);

    await markStageStep(runId, "discovering");

    // Stage0: Places軽量再同期(best-effort)。in-memoryでのみ利用し、DBへは書き込まない。
    // google_place_idが無い場合はText Search fallback(strong matchのみ採用)を試みる
    // (feat/ai-research-quality-refinement)。
    const stage0 = await stage0PlacesStep(googlePlaceId, store);

    // Stage0の結末をsanitizedにログへ残す(feat/ai-research-quality-ux-hardening、Plan §6.3)。
    // 従来は失敗時のwarningしか残らず、google_place_idが無い店舗でText Searchが
    // strong matchしたのかを後から観測できなかった。値は載せない(種別のみ)。
    console.info("[research.stage0] resync", { runId, ...stage0.diagnostic });

    // --- fresh evidence 経路(canonicalから独立、Plan §6.1)-------------------
    //
    // 以前はここで `mergeBasicInfo(basicInfo, stage0.placesBasicInfo, "places", ...)` を
    // 通した **マージ後** の basic_info から Places 検証済みkeyを導いていた。
    // `mergeBasicInfo` の manual 保護(`lib/domain/basic-info-merge.ts:88`)は
    // canonical DB を守るための正しい規則だが、DBへ書かないin-memory経路にも等しく
    // 効くため、「Placesが今まさに答えている値」が保護規則によって破棄されていた。
    // さらに review での採用が `filled_by:"manual"` を書くため、**正しく運用するほど
    // 次回の調査品質が下がる**自己増悪ループになっていた(実機事象: 炉端ジュン)。
    //
    // 現在は Stage0 の生の結果だけを見る。canonical 側の manual 保護は一切変更していない
    // (canonical への書き込みは従来どおり review 経由のみ)。
    // --- canonical fallback 経路(Plan §7)------------------------------------
    //
    // freshで取得できなかった項目のうち、canonicalに確定情報があるものを
    // 「今回は再確認できていない既知情報」として合成する。fresh と偽装しないため
    // evidence_basis="existing_canonical" / confidence=null / source_ids=[] を付ける。
    // 対象は CANONICAL_FALLBACK_KEYS の3項目のみ。
    //
    // 上記2経路の導出は純関数 `buildDeterministicItems` に集約している。
    // Workflow 本体はテストで丸ごとmockされるため、この相互作用をWorkflow内へ
    // インライン展開すると再びテスト不能になる(Q1が検知されなかった原因)。
    const deterministic = buildDeterministicItems({
      freshPlacesBasicInfo: stage0.placesBasicInfo,
      canonicalBasicInfo: basicInfo,
    });
    const deterministicItems = deterministic.items;
    // deterministicに確定した項目はGemini対象から除外する
    // (偽装経路が構造的に消え、同時にStage2の出力tokenも減る)。
    const deterministicKeys = deterministic.deterministicKeys;

    // Stage1: Source Discovery(Google Search)。
    const stage1 = await stage1Step(store);
    stage1Usage = stage1.usageMetadata;

    // known_store_data(既存DBの公開URL)をSource Registryへ優先seedする。
    const knownEntries = buildKnownStoreDataEntries(knownStoreDataUrls);
    const mergedRegistry = mergeKnownStoreDataIntoRegistry(stage1.sourceRegistry, knownEntries);
    // known official URL と Google Search 候補が同一ページであることをコード側で
    // 決定的に確認できた場合のみ統合する(Q5、Plan §8.2)。trust boundary は無改変で、
    // 統合できなければ従来どおりの判定になる(退化ではない)。
    const resolvedRegistry = await resolveAndPersistSourceRegistryStep(
      runId,
      mergedRegistry,
      knownStoreDataUrls.map((u) => u.url),
    );

    await markStageStep(runId, "researching");

    // Stage2: URL Context + Structured Output(単一call)。Stage1のSearch Notesも渡す。
    const stage2Result = await stage2Step(store, resolvedRegistry, stage1.searchNotes, deterministicKeys);

    const urlContextAppliedRegistry = applyUrlContextStatus(resolvedRegistry, [stage2Result.urlContextMetadata]);
    // fix/ai-research-source-identity-integrity: url_context成功=ページ取得成功であり
    // 「対象店舗のページだった」ことを意味しない(実機smokeで確認した誤ったHotPepper URL
    // の事故)。Stage2の`source_verifications`とStoreIdentityをコード側で突合し、
    // `identity_status`をSource Registryへ反映する。追加のGemini呼出は発生しない。
    const finalRegistry = applySourceIdentityVerification(
      urlContextAppliedRegistry,
      stage2Result.sourceVerifications,
      store,
    );

    // Stage1のSearch Notes(store_fact、key/value構造化済み)をSource RegistryのIDへ解決する
    // (feat/ai-research-quality-refinement、Tier BのSearchFact照合に使う)。
    //
    // ## alias統合で破棄されたcandidateのSearchFactは意図的に捨てる
    //
    // `resolveOfficialAliases` が `gemini_search_candidate` を known_store_data エントリへ
    // 統合すると、そのredirect URLはregistryから消えるため下の lookup が miss し、
    // 対応するSearchFactは `sourceId === undefined` として除外される。**これは意図的**:
    //
    // - Tier B(`isTierBEligible`、`research-result-schema.ts:752`)は
    //   `discovery_provenance === "known_store_data"` のみを許可する。統合**前**の
    //   candidate 由来SearchFactはそもそもTier B対象外であり、捨てても
    //   confirmed判定にも `pruneUnverifiedSourceIds` の表示にも影響しない。
    // - 逆に統合先(known_store_data)のIDへ**rewriteすると**、Stage1の検索スニペット
    //   由来の値が「known_store_dataのSearchFact」に化けてTier B適格になってしまう。
    //   それはredirect一致を根拠にtrust boundaryを緩める行為であり、本PRの方針
    //   (false positiveよりfalse negativeを優先)に反する。
    //
    // したがって「rewriteしない = 捨てる」が正しい。
    const registryIdByUrl = new Map(finalRegistry.map((s) => [s.grounding_redirect_url, s.id]));
    const searchFacts: SearchFact[] = stage1.searchNotes
      .filter((n): n is SearchNote & { key: string; value: string } => !!n.key && !!n.value)
      .map((n) => ({ sourceId: registryIdByUrl.get(n.sourceUrl), key: n.key, value: n.value }))
      .filter((f): f is SearchFact => f.sourceId !== undefined);

    // own_net_exposure/exposure_gapの自己矛盾防止・media_coverageの解釈漏れ補正
    // (feat/ai-research-final-quality、fix/ai-research-source-identity-integrityで
    // identity_status必須化)。Stage2完了後のfinalRegistryからdeterministicに構築する
    // ため、追加のGemini呼出は発生しない。
    const mediaCorrectedItems = upgradeMediaCoverageFromRegistry(stage2Result.items, finalRegistry);
    const aiItemsWithContext = appendConfirmedMediaContext(mediaCorrectedItems, finalRegistry);

    const finalItems = finalizeResearchItems({
      aiItems: [...aiItemsWithContext, ...deterministicItems],
      nonAiItems: buildNonAiItems(),
      sourceRegistry: finalRegistry,
      placesVerifiedKeys: deterministic.placesConfirmedKeys,
      // 実際に合成したcanonical fallback itemのkeyだけを渡す。trust boundary側では
      // `evidence_basis==="existing_canonical"` とのANDで判定される(二重防御)。
      canonicalVerifiedKeys: deterministic.canonicalConfirmedKeys,
      searchFacts,
    });

    // 保存直前のcanonical順ソート + 最終不変条件チェック(feat/ai-research-pre-smoke-hardening、
    // BLOCKER1)。53項目exact・key重複なし・未知keyなしを満たさない場合は
    // succeededとして保存せず、failedへ倒す(生の中身はログに残さずsanitizedなkindのみ)。
    const orderedItems = sortResearchItemsToCanonicalOrder(finalItems);
    const integrityViolation = validateFinalResearchResultIntegrity(orderedItems);
    if (integrityViolation !== null) {
      throw new FatalError(`最終結果の整合性検証に失敗しました(final_result_invalid)`);
    }

    const warnings: string[] = [];
    if (stage0.warning) warnings.push(stage0.warning);
    if (finalRegistry.length === 0) {
      warnings.push(
        "Web情報源候補が1件も取得できませんでした(Gemini検索候補・登録済みURLともに0件)。",
      );
    } else if (finalRegistry.every((entry) => entry.url_context_status !== "success")) {
      warnings.push(
        "Webページを確認できた情報源がありません(候補はありましたが、いずれも本文取得に失敗しました)。",
      );
    }

    await persistSucceededStep(runId, {
      items: orderedItems,
      sourceRegistry: finalRegistry,
      tokenUsage: {
        stage1: stage1.usageMetadata,
        // jsonb (`store_research_runs.token_usage`) 配下のため、フィールド追加に
        // migration は不要。保存するのは件数と boolean のみで、検索クエリ文字列は
        // `client.ts:extractSearchDiagnostics` の中で破棄済み(ここには届かない)。
        stage1_diagnostics: {
          search_call_count: stage1.searchCallCount,
          search_query_count: stage1.searchQueryCount,
          // 食べログ検索の mandatory attempt を実際に行ったか(PR #180 BLOCKER 1)。
          // false でも run は succeeded のまま継続する(observability のみ)。
          tabelog_search_attempted: stage1.tabelogSearchAttempted,
          // 検索実行後にどこで食べログが消えたかを次回 smoke で分離するための診断値。
          // emitted=false / mentions_domain=true なら「SOURCE ブロック内に書いたが
          // 既存 parser の要求形式を満たさなかった」、両方 false なら
          // 「モデル出力に食べログ SOURCE 自体が無い」と読む。いずれも run は失敗させない。
          tabelog_source_emitted: stage1.tabelogSourceEmitted,
          tabelog_source_block_mentions_domain: stage1.tabelogSourceBlockMentionsDomain,
        },
        stage2_combined: stage2Result.usageMetadata,
      },
      warnings,
    });

    return { runId, status: "succeeded" };
  } catch (err) {
    // running状態から抜け出せない状態を作らない(Plan §17の必須要件)。
    // Workflow自体もfailedとして記録されるようre-throwする(観測性の二重化)。
    await markFailedStep(runId, err, stage1Usage);
    throw err;
  }
}
