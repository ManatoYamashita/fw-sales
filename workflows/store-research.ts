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
  buildDeterministicPlacesItems,
  DETERMINISTIC_PLACES_KEYS,
  applyUrlContextStatus,
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
import { derivePlacesVerifiedKeys } from "@/lib/ai/research/places-verified";
import { mergeBasicInfo } from "@/lib/domain/basic-info-merge";
import { isAiClientError } from "@/lib/ai/client";
import type { StoreIdentity } from "@/lib/ai/research/prompts";
import type { SourceRegistryEntry, ResearchItem, SearchFact } from "@/lib/ai/research-result-schema";
import {
  sortResearchItemsToCanonicalOrder,
  validateFinalResearchResultIntegrity,
} from "@/lib/ai/research-result-schema";
import type { SearchNote } from "@/lib/ai/research/source-registry";
import type { BasicInfo } from "@/types/basic-info";
import { nowIso } from "@/lib/utils/date";

/** 1 stage あたりのGemini呼出timeout。Hobbyの個別Function上限(300秒)に収まる値。 */
const STAGE_TIMEOUT_MS = 240_000;

/**
 * `classifyForWorkflowRetry` が `FatalError`/`RetryableError` のメッセージへ埋め込む
 * sanitized kind トークンの正規表現(`deriveErrorKind` 側の抽出と対になる)。
 *
 * PR #187 で修正済み: `api_error` のみ `api_error:<status>` の形で HTTP status を保持する。
 * ここに載せてよいのは正規化済みの kind と HTTP status のみで、SDK の生メッセージ・
 * request ID・API key は一切含めない。この観測性・503 retry の修正は本PRでも維持する。
 */
const SANITIZED_KIND_PATTERN =
  /\((auth_error|missing_api_key|rate_limit|timeout|network_error|max_tokens|api_error:\d{3}|stage2_invalid_output|final_result_invalid|unknown)\)/;

/**
 * `AiClientError` を Workflow の retry 意味論(`FatalError` / `RetryableError`)へ変換する。
 * 純関数としてexportし、単体テストで直接検証する。PR #187 の修正内容を維持している
 * (絶対に壊さない): 503 (service unavailable) は 429 / timeout / network_error と同じ
 * 「最大1 retry」対象。`api_error` の他ステータス(400/404/500 等)は安全側に倒しretryしない。
 */
export function classifyForWorkflowRetry(err: unknown): Error {
  if (err instanceof Stage2InvalidOutputError) {
    // Stage2の応答がJSON parse/schema/coverageのいずれかで失敗した場合(BLOCKER1)。
    // 自動的なGemini再callは追加しない(ユーザーが再調査を選べればよい)ため retry 0。
    return new FatalError(`Stage2の応答検証に失敗しました(stage2_invalid_output)`);
  }
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
 * PR #187 の修正内容を維持している(絶対に壊さない)。
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
loadStoreStep.maxRetries = 1;

async function markStageStep(
  runId: string,
  stage: "discovering" | "researching" | "done",
): Promise<void> {
  "use step";
  await repos.researchRun.update(runId, { stage });
}
markStageStep.maxRetries = 1;

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
  return runStage0PlacesResync({ googlePlaceId, store, now: nowIso() });
}
stage0PlacesStep.maxRetries = 0;

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
 * 1 runあたりのGemini API呼出は原則2回(Stage1 1回・Stage2 1回)。
 * Google Places API呼出は `google_place_id` が存在する場合のみ最大1回(Stage0)。
 * それ以外の外部検索APIは呼ばない。
 */
export async function storeResearchWorkflow(
  runId: string,
  storeId: string,
): Promise<StoreResearchWorkflowResult> {
  "use workflow";

  try {
    const { store, basicInfo, googlePlaceId, knownStoreDataUrls } = await loadStoreStep(storeId);

    await markStageStep(runId, "discovering");

    // Stage0: Places軽量再同期(best-effort)。in-memoryでのみ利用し、DBへは書き込まない。
    // google_place_idが無い場合はText Search fallback(strong matchのみ採用)を試みる
    // (feat/ai-research-quality-refinement)。
    const stage0 = await stage0PlacesStep(googlePlaceId, store);
    const effectiveBasicInfo = mergeBasicInfo(basicInfo, stage0.placesBasicInfo, "places", nowIso());
    // derivePlacesVerifiedKeysは最大6key(store_name/address/cuisine_genre/phone/
    // review_avg/review_count)を返すが、実際にPlaces値から直接生成しているのは
    // review_avg/review_countの2keyのみ(buildDeterministicPlacesItems参照)。
    // 6key全てを`finalizeResearchItems`のplacesVerifiedKeysへそのまま渡すと、
    // AIが生成したstore_name/address/cuisine_genre/phoneのvalueが、値の中身を
    // 見ずにkey一致だけでconfirmed維持されてしまう(BLOCKER2)。deterministic item
    // 生成には引き続き広いplacesVerifiedKeySetを使い、trust boundary(finalizeResearchItems)
    // へはDETERMINISTIC_PLACES_KEYSのみに絞った集合を渡す。
    const placesVerifiedKeySet = derivePlacesVerifiedKeys(effectiveBasicInfo);
    const placesConfirmedBypassKeys = new Set(
      [...placesVerifiedKeySet].filter((key) =>
        (DETERMINISTIC_PLACES_KEYS as readonly string[]).includes(key),
      ),
    );

    // Google Placesがdeterministicに確定済みのkey(review_avg/review_count)は、
    // Gemini対象から除外しdeterministic itemとして直接合成する(feat/ai-research-quality-refinement)。
    const deterministicPlacesItems = buildDeterministicPlacesItems(effectiveBasicInfo, placesVerifiedKeySet);
    const deterministicKeys = deterministicPlacesItems.map((item) => item.key);

    // Stage1: Source Discovery(Google Search)。
    const stage1 = await stage1Step(store);

    // known_store_data(既存DBの公開URL)をSource Registryへ優先seedする。
    const knownEntries = buildKnownStoreDataEntries(knownStoreDataUrls);
    const mergedRegistry = mergeKnownStoreDataIntoRegistry(stage1.sourceRegistry, knownEntries);
    await persistSourceRegistryStep(runId, mergedRegistry);

    await markStageStep(runId, "researching");

    // Stage2: URL Context + Structured Output(単一call)。Stage1のSearch Notesも渡す。
    const stage2Result = await stage2Step(store, mergedRegistry, stage1.searchNotes, deterministicKeys);

    const finalRegistry = applyUrlContextStatus(mergedRegistry, [stage2Result.urlContextMetadata]);

    // Stage1のSearch Notes(store_fact、key/value構造化済み)をSource RegistryのIDへ解決する
    // (feat/ai-research-quality-refinement、Tier BのSearchFact照合に使う)。
    const registryIdByUrl = new Map(finalRegistry.map((s) => [s.grounding_redirect_url, s.id]));
    const searchFacts: SearchFact[] = stage1.searchNotes
      .filter((n): n is SearchNote & { key: string; value: string } => !!n.key && !!n.value)
      .map((n) => ({ sourceId: registryIdByUrl.get(n.sourceUrl), key: n.key, value: n.value }))
      .filter((f): f is SearchFact => f.sourceId !== undefined);

    // own_net_exposure/exposure_gapの自己矛盾防止・media_coverageの解釈漏れ補正
    // (feat/ai-research-final-quality)。Stage2完了後のfinalRegistryから
    // deterministicに構築するため、追加のGemini呼出は発生しない。
    const mediaCorrectedItems = upgradeMediaCoverageFromRegistry(stage2Result.items, finalRegistry, searchFacts);
    const aiItemsWithContext = appendConfirmedMediaContext(mediaCorrectedItems, finalRegistry);

    const finalItems = finalizeResearchItems({
      aiItems: [...aiItemsWithContext, ...deterministicPlacesItems],
      nonAiItems: buildNonAiItems(),
      sourceRegistry: finalRegistry,
      placesVerifiedKeys: placesConfirmedBypassKeys,
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
        stage1_diagnostics: {
          search_call_count: stage1.searchCallCount,
          search_query_count: stage1.searchQueryCount,
        },
        stage2_combined: stage2Result.usageMetadata,
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
