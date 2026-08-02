/**
 * AI 店舗調査の Vercel Workflow 定義(AI 店舗調査再設計 Plan v3.2 §16, PR3)。
 *
 * fw-sales の実際の Vercel Team は Hobby プランであることを確認済み。Hobby でも
 * Fluid Compute・Vercel Workflows は利用可能。個別 Function の実行時間上限(300秒)を
 * 踏まえ、各 Gemini 呼び出し・各 Web リクエストを個別の Workflow step へ分割することで、
 * パイプライン全体を1つの Function 呼び出しに収める必要がない設計にしている(Plan §16)。
 *
 * ## 重要な注意(実装時の確認事項)
 *
 * この実装は Vercel Workflow SDK(`workflow@5.0.0-beta.38`、2026-08時点で **beta**)の
 * 公式ドキュメント(vercel.com/docs/workflows, workflow-sdk.dev)を実装直前に確認した
 * 内容に基づく。実際に Vercel へデプロイして動かす実機検証は本セッションのスコープ外
 * (production変更禁止のため)であり、**未検証**である。PR3のマージ前に、プレビュー
 * デプロイ上で最低1回の実 workflow run を手動で確認することを強く推奨する。
 *
 * ## retry方針(Plan v3.2 §17、確定)
 *
 * - auth / 400 / invalid schema → retry 0(`FatalError`)
 * - 429 / 503 / network timeout → 最大1 retry(step の `maxRetries = 1` + `RetryableError`)
 * - その他 → 安全側に倒し `FatalError`(無闇な自動retryをしない)
 *
 * ## idempotency(Plan v3.2 §17)
 *
 * Gemini API 自体はidempotency keyをサポートしないため、各 Gemini 呼び出しstepは
 * 「呼び出して結果を返すだけ」に責務を絞り、DB書き込み等の副作用を同じstep内に
 * 混在させない。DB書き込みstep(`persist*Step`)は `store_research_runs` の
 * jsonb列の全置換(マージではない、PR1の設計)であるため、リトライで複数回実行されても
 * 安全(同じ最終値を書き込むだけ)。
 *
 * 関連: Plan v3.2 §8, §16, §17
 */

import { FatalError, RetryableError } from "workflow";
import { repos } from "@/lib/repositories";
import {
  runStage1,
  runStage2,
  buildNonAiItems,
  applyUrlContextStatus,
  finalizeResearchItems,
} from "@/lib/ai/research/pipeline";
import { resolveGroundingRedirectUrl } from "@/lib/ai/research/source-url-resolver";
import { derivePlacesVerifiedKeys } from "@/lib/ai/research/places-verified";
import { isAiClientError } from "@/lib/ai/client";
import type { StoreIdentity, Stage2Track } from "@/lib/ai/research/prompts";
import type { SourceRegistryEntry, ResearchItem } from "@/lib/ai/research-result-schema";
import { nowIso } from "@/lib/utils/date";

/** 1 stage あたりのGemini呼出timeout。Hobbyの個別Function上限(300秒)に収まる値。 */
const STAGE_TIMEOUT_MS = 240_000;

/**
 * `classifyForWorkflowRetry` が `FatalError`/`RetryableError` のメッセージへ埋め込む
 * sanitized kind トークンの正規表現(`deriveErrorKind` 側の抽出と対になる)。
 *
 * `api_error` のみ `api_error:<status>` の形で HTTP status を保持する(observability bug
 * 修正、smoke test #2 で発見。以前は `err.status` が message 生成時に握り潰されており、
 * 400/404/500/503 等の区別が `store_research_runs.error_message` からできなかった)。
 * ここに載せてよいのは正規化済みの kind と HTTP status のみで、SDK の生メッセージ・
 * request ID・API key は一切含めない。
 */
const SANITIZED_KIND_PATTERN =
  /\((auth_error|missing_api_key|rate_limit|timeout|network_error|max_tokens|api_error:\d{3}|unknown)\)/;

/**
 * `AiClientError` を Workflow の retry 意味論(`FatalError` / `RetryableError`)へ変換する。
 * 純関数としてexportし、単体テストで直接検証する(実際の "use step" コンパイルを
 * 経由せずロジックだけを確認できるようにするため)。
 *
 * 503 (service unavailable) は Plan v3.2 §17 のとおり 429 / timeout / network_error と
 * 同じ「最大1 retry」対象。`api_error` の他ステータス(400/404/500 等)は安全側に倒し
 * retry しない(FatalError)。
 */
export function classifyForWorkflowRetry(err: unknown): Error {
  if (isAiClientError(err)) {
    switch (err.kind) {
      case "rate_limit":
      case "timeout":
      case "network_error":
        return new RetryableError(
          `Gemini呼出が一時的に失敗しました(${err.kind})。1回だけ再試行します。`,
          { retryAfter: "5s" },
        );
      case "missing_api_key":
      case "auth_error":
        return new FatalError(`Gemini呼出が認証エラーで失敗しました(${err.kind})`);
      case "api_error": {
        if (err.status === 503) {
          return new RetryableError(
            `Gemini呼出が一時的に失敗しました(api_error:503)。1回だけ再試行します。`,
            { retryAfter: "5s" },
          );
        }
        return new FatalError(`Gemini呼出が失敗しました(api_error:${err.status})`);
      }
      case "max_tokens":
      case "unknown":
      default:
        return new FatalError(`Gemini呼出が失敗しました(${err.kind})`);
    }
  }
  return new FatalError(err instanceof Error ? err.message : "不明なエラーで失敗しました");
}

/**
 * エラーオブジェクトから `store_research_runs.error_kind` へ書き込む短い文字列を導出する。
 *
 * `FatalError`/`RetryableError` は `classifyForWorkflowRetry` が埋め込んだ sanitized kind
 * (HTTP status 込み)をメッセージから抽出し、`"fatal:api_error:404"` /
 * `"retryable_exhausted:api_error:503"` のように prefix + kind の形で返す。抽出できない
 * 場合(`loadStoreStep`/`markStageStep`等、Gemini呼出以外が投げた `FatalError` 等)は
 * 従来どおり `"fatal"` / `"retryable_exhausted"` にフォールバックする。
 *
 * 抽出元の message は本関数自身が `classifyForWorkflowRetry` で組み立てた定型文のみであり、
 * SDK の生メッセージ・request ID・API key を含まない(安全性は生成側で担保済み)。
 */
export function deriveErrorKind(err: unknown): string {
  if (err instanceof FatalError) {
    const match = err.message.match(SANITIZED_KIND_PATTERN);
    return match?.[1] !== undefined ? `fatal:${match[1]}` : "fatal";
  }
  if (err instanceof RetryableError) {
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
  placesVerifiedKeys: string[];
}

async function loadStoreStep(storeId: string): Promise<LoadedStore> {
  "use step";
  const store = await repos.store.get(storeId);
  if (!store) {
    throw new FatalError(`店舗が見つかりません: ${storeId}`);
  }
  const verified = derivePlacesVerifiedKeys(store.basic_info);
  return {
    store: {
      name: store.name,
      address: store.address,
      phone: store.phone,
      genre: store.genre,
    },
    placesVerifiedKeys: Array.from(verified),
  };
}
loadStoreStep.maxRetries = 1;

async function markStageStep(
  runId: string,
  stage: "discovering" | "researching" | "done",
): Promise<void> {
  "use step";
  await repos.researchRun.update(runId, { stage });
}
markStageStep.maxRetries = 1;

async function stage1Step(store: StoreIdentity) {
  "use step";
  try {
    return await runStage1(store, AbortSignal.timeout(STAGE_TIMEOUT_MS));
  } catch (err) {
    throw classifyForWorkflowRetry(err);
  }
}
stage1Step.maxRetries = 1;

async function persistSourceRegistryStep(
  runId: string,
  sourceRegistry: SourceRegistryEntry[],
): Promise<void> {
  "use step";
  await repos.researchRun.update(runId, { source_registry: sourceRegistry });
}
persistSourceRegistryStep.maxRetries = 1;

/**
 * Stage 1.5: 1件のSource Registryエントリを安全に解決する。
 * `resolveGroundingRedirectUrl` は内部で例外を投げない設計(best-effort)のため、
 * step自体のretryは不要(`maxRetries = 0`)。
 */
async function resolveSourceStep(entry: SourceRegistryEntry): Promise<SourceRegistryEntry> {
  "use step";
  const outcome = await resolveGroundingRedirectUrl(entry.grounding_redirect_url);
  if (outcome.status === "resolved") {
    return { ...entry, resolved_url: outcome.url, resolve_status: "resolved" };
  }
  return { ...entry, resolved_url: null, resolve_status: "failed" };
}
resolveSourceStep.maxRetries = 0;

async function stage2Step(store: StoreIdentity, track: Stage2Track, sourceRegistry: SourceRegistryEntry[]) {
  "use step";
  try {
    return await runStage2({ store, track, sourceRegistry }, AbortSignal.timeout(STAGE_TIMEOUT_MS));
  } catch (err) {
    throw classifyForWorkflowRetry(err);
  }
}
stage2Step.maxRetries = 1;

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
persistSucceededStep.maxRetries = 1;

async function markFailedStep(runId: string, err: unknown): Promise<void> {
  "use step";
  const message = err instanceof Error ? err.message : "不明なエラーで失敗しました";
  await repos.researchRun.update(runId, {
    status: "failed",
    error_kind: deriveErrorKind(err),
    error_message: message,
    finished_at: nowIso(),
  });
}
markFailedStep.maxRetries = 1;

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
 * Stage0(Places再同期)の実ライブ呼び出しは本PRのスコープ外(既存 `stores.basic_info` の
 * スナップショットをそのまま使う)。
 */
export async function storeResearchWorkflow(
  runId: string,
  storeId: string,
): Promise<StoreResearchWorkflowResult> {
  "use workflow";

  try {
    const { store, placesVerifiedKeys } = await loadStoreStep(storeId);
    const placesVerifiedKeySet = new Set(placesVerifiedKeys);

    await markStageStep(runId, "discovering");
    const stage1 = await stage1Step(store);
    await persistSourceRegistryStep(runId, stage1.sourceRegistry);

    // Stage 1.5: Source Registry全件を並列で安全解決する(best-effort、失敗しても継続)。
    const resolvedRegistry = await Promise.all(
      stage1.sourceRegistry.map((entry) => resolveSourceStep(entry)),
    );
    await persistSourceRegistryStep(runId, resolvedRegistry);

    await markStageStep(runId, "researching");
    const [factResult, analysisResult] = await Promise.all([
      stage2Step(store, "FACT", resolvedRegistry),
      stage2Step(store, "ANALYSIS", resolvedRegistry),
    ]);

    const finalRegistry = applyUrlContextStatus(resolvedRegistry, [
      factResult.urlContextMetadata,
      analysisResult.urlContextMetadata,
    ]);
    const finalItems = finalizeResearchItems({
      factItems: factResult.items,
      analysisItems: analysisResult.items,
      nonAiItems: buildNonAiItems(),
      sourceRegistry: finalRegistry,
      placesVerifiedKeys: placesVerifiedKeySet,
    });

    const warnings = [factResult.parseWarning, analysisResult.parseWarning].filter(
      (w): w is string => w !== null,
    );

    await persistSucceededStep(runId, {
      items: finalItems,
      sourceRegistry: finalRegistry,
      tokenUsage: {
        stage1: stage1.usageMetadata,
        stage2_fact: factResult.usageMetadata,
        stage2_analysis: analysisResult.usageMetadata,
      },
      warnings,
    });

    return { runId, status: "succeeded" };
  } catch (err) {
    // running状態から抜け出せない状態を作らない(Plan §17の必須要件)。
    // Workflow自体もfailedとして記録されるようre-throwする(観測性の二重化)。
    await markFailedStep(runId, err);
    throw err;
  }
}
