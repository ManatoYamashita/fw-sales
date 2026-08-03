/**
 * AI 店舗調査パイプラインのオーケストレーション(AI 店舗調査再設計 Plan v3.2 §8, PR2、
 * fix/ai-research-poc-like-retrieval で Stage2 統合・Source Registry方針転換)。
 *
 * PR2 のスコープは各Stageを独立した呼び出し可能関数として提供することまで。
 * Vercel Workflow 上のstepとしての結線(PR3)や、Places軽量再同期の実行(Stage0の
 * 実際のAPI呼出)はここでは行わない。`derivePlacesVerifiedKeys` は
 * `stores.basic_info` の**現在のスナップショット**を受け取るだけで、Places API を
 * 呼び出さない(`lib/ai/research/places-verified.ts` 参照)。Stage0の実ライブ呼出は
 * `lib/ai/research/places-stage0.ts`(fix/ai-research-poc-like-retrieval で新設)。
 *
 * 各関数は個別に呼び出し可能な設計にしている(PR3 で Workflow の各 step が
 * それぞれを呼ぶ想定)。
 */

import "server-only";

import { RESEARCH_POLICY_ITEMS, getResearchPolicy } from "@/lib/domain/research-policy";
import { buildSourceRegistry, parseSearchNotes, type GroundingMetadataLike, type SearchNote } from "./source-registry";
import { buildStage1Prompt, buildStage2Prompt, selectAiResearchItems, type StoreIdentity } from "./prompts";
import { buildStage2JsonSchema, buildStage2ResponseZodSchema } from "./schema-builder";
import { createResearchGeminiClient, type UsageMetadataLike, type UrlContextMetadataLike } from "./client";
import {
  applyDeterministicValidation,
  type ResearchItem,
  type SearchFact,
  type SourceRegistryEntry,
} from "@/lib/ai/research-result-schema";
import type { BasicInfo } from "@/types/basic-info";

/* ------------------------------------------------------------------ */
/*  Stage 1: Source Discovery                                          */
/* ------------------------------------------------------------------ */

export interface Stage1Outcome {
  sourceRegistry: SourceRegistryEntry[];
  discoveryText: string;
  usageMetadata: UsageMetadataLike | null;
  /** Google Search server-side tool call回数(診断用、fix/ai-research-poc-like-retrieval)。 */
  searchCallCount: number;
  /** 上記に含まれた検索クエリの合計件数(診断用)。 */
  searchQueryCount: number;
  /**
   * Stage1のGoogle Search実行時に得られた補助情報(feat/ai-research-source-diversity)。
   * URL Context本文取得より一段弱い根拠として、Stage2プロンプトへ受け渡す。
   */
  searchNotes: SearchNote[];
}

export async function runStage1(
  store: StoreIdentity,
  signal: AbortSignal,
): Promise<Stage1Outcome> {
  const client = createResearchGeminiClient();
  const prompt = buildStage1Prompt(store);
  const result = await client.runSourceDiscovery(prompt, signal);

  return {
    sourceRegistry: buildSourceRegistry(result.groundingMetadata, result.text),
    discoveryText: result.text,
    usageMetadata: result.usageMetadata,
    searchCallCount: result.searchCallCount,
    searchQueryCount: result.searchQueryCount,
    searchNotes: parseSearchNotes(result.text),
  };
}

/* ------------------------------------------------------------------ */
/*  Stage 2: FACT / FACT_OR_HEARING / ANALYSIS(URL Context + Structured Output、単一call) */
/* ------------------------------------------------------------------ */

export interface Stage2Outcome {
  items: ResearchItem[];
  urlContextMetadata: UrlContextMetadataLike | null;
  usageMetadata: UsageMetadataLike | null;
  /** Zod検証に失敗した場合の警告(部分成功を許容するため例外は投げない)。 */
  parseWarning: string | null;
}

/**
 * Stage2: AI対象項目(FACT + FACT_OR_HEARING + ANALYSIS、計42項目)を1回のGemini呼出で
 * 生成する(fix/ai-research-poc-like-retrieval、PoCと同様の単一call構成へ回帰)。
 */
export async function runStage2(
  params: {
    store: StoreIdentity;
    sourceRegistry: readonly SourceRegistryEntry[];
    searchNotes?: readonly SearchNote[];
    /**
     * Stage0のGoogle Placesでdeterministicに確定済みのkey(feat/ai-research-quality-refinement、
     * 例: review_avg/review_count)。Geminiへ投げる項目一覧から除外し、hallucinationリスクと
     * 出力トークンを削減する(`buildDeterministicPlacesItems`参照)。
     */
    excludeKeys?: ReadonlySet<string>;
  },
  signal: AbortSignal,
): Promise<Stage2Outcome> {
  const { store, sourceRegistry, searchNotes = [], excludeKeys } = params;
  const items = selectAiResearchItems(RESEARCH_POLICY_ITEMS, excludeKeys);
  const allowedKeys = items.map((i) => i.key);
  const registryIds = sourceRegistry.map((s) => s.id);

  const prompt = buildStage2Prompt({ store, items, sourceRegistry, searchNotes });
  const jsonSchema = buildStage2JsonSchema({ allowedKeys, registryIds });
  const client = createResearchGeminiClient();

  const result = await client.runStructuredUrlContext({ prompt, jsonSchema }, signal);

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(result.rawText);
  } catch {
    return {
      items: [],
      urlContextMetadata: result.urlContextMetadata,
      usageMetadata: result.usageMetadata,
      parseWarning: "Stage2の応答をJSONとして解釈できませんでした。",
    };
  }

  const zodSchema = buildStage2ResponseZodSchema(allowedKeys, registryIds);
  const parsed = zodSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return {
      items: [],
      urlContextMetadata: result.urlContextMetadata,
      usageMetadata: result.usageMetadata,
      parseWarning: `Stage2の応答がスキーマに準拠しませんでした: ${parsed.error.issues[0]?.message ?? "unknown"}`,
    };
  }

  return {
    items: parsed.data.items as ResearchItem[],
    urlContextMetadata: result.urlContextMetadata,
    usageMetadata: result.usageMetadata,
    parseWarning: null,
  };
}

/* ------------------------------------------------------------------ */
/*  HEARING_ONLY / EXTERNAL_DATA_REQUIRED(AI呼び出しなし)                */
/* ------------------------------------------------------------------ */

/**
 * research_policy が HEARING_ONLY / EXTERNAL_DATA_REQUIRED の項目を、AI呼び出し無しで
 * 機械的に生成する(Plan v3.2 §8)。API呼び出しコストはゼロ、失敗しようがない。
 */
export function buildNonAiItems(): ResearchItem[] {
  return RESEARCH_POLICY_ITEMS.filter(
    (item) =>
      item.research_policy === "HEARING_ONLY" || item.research_policy === "EXTERNAL_DATA_REQUIRED",
  ).map((item) => ({
    key: item.key,
    research_policy: item.research_policy,
    status: item.research_policy === "HEARING_ONLY" ? "hearing_required" : "external_data_required",
    value: null,
    evidence:
      item.research_policy === "HEARING_ONLY"
        ? "店主にしか分からない内部情報のため、AI調査の対象外です。"
        : "現在のWeb調査方式では正確な値を取得できないため、対象外です。",
    source_ids: [],
  }));
}

/* ------------------------------------------------------------------ */
/*  Google Places由来のdeterministic item(feat/ai-research-quality-refinement） */
/* ------------------------------------------------------------------ */

/**
 * Google Placesがdeterministicに確定できるkey(review_avg/review_count限定)。
 *
 * 店舗名/住所/業種/電話番号はGemini + 既存`placesVerifiedKeys`バイパスで実測上すでに
 * confirmedできており、Placesで一律上書きすると電話番号のroleの違い(店舗直通/予約専用等、
 * Stage2プロンプトの較正対象)のような有用な情報を失うリスクがあるため対象外とする。
 * `review_avg`/`review_count`はWeb調査でGeminiが正確に再現しづらく(Google公式評価を
 * 直接掲載する第三者サイトが少ない)、Places側で確定できるなら常にそちらを優先すべき
 * 数少ない項目のため、この2keyに限定してGemini対象からも除外する
 * (`runStage2`の`excludeKeys`と対で使う)。
 */
export const DETERMINISTIC_PLACES_KEYS = ["review_avg", "review_count"] as const;

/**
 * Stage0でGoogle Placesが確認済みの`review_avg`/`review_count`から、AI呼出無しで
 * confirmedなResearchItemを直接合成する(feat/ai-research-quality-refinement)。
 * `placesVerifiedKeys`に含まれないkey、または値が空のkeyはスキップする
 * (`derivePlacesVerifiedKeys`が`filled_by==="places"`かつ非空の場合のみ含めるため、
 * manual保護は`effectiveBasicInfo`の生成側(`mergeBasicInfo`)が既に担保している)。
 */
export function buildDeterministicPlacesItems(
  effectiveBasicInfo: BasicInfo,
  placesVerifiedKeys: ReadonlySet<string>,
): ResearchItem[] {
  const items: ResearchItem[] = [];
  for (const key of DETERMINISTIC_PLACES_KEYS) {
    if (!placesVerifiedKeys.has(key)) continue;
    const field = effectiveBasicInfo[key];
    if (!field?.value) continue;
    items.push({
      key,
      research_policy: getResearchPolicy(key)!,
      status: "confirmed",
      value: field.value,
      evidence: "Google Placesで確認済みの情報です。",
      source_ids: [],
      confidence: 100,
      evidence_basis: "places",
    });
  }
  return items;
}

/* ------------------------------------------------------------------ */
/*  Source Registry への url_context_status 反映                        */
/* ------------------------------------------------------------------ */

/**
 * Stage2 の `urlContextMetadata` を Source Registry に反映する。
 * `retrievedUrl` が `grounding_redirect_url` と一致するエントリの `url_context_status` を
 * 更新する。参照されなかったエントリは `not_attempted` のまま。
 *
 * 純関数。入力を変更せず、新しい配列を返す。
 */
export function applyUrlContextStatus(
  sourceRegistry: readonly SourceRegistryEntry[],
  urlContextMetadataList: readonly (UrlContextMetadataLike | null)[],
): SourceRegistryEntry[] {
  const statusByUrl = new Map<string, "success" | "error">();
  for (const ucm of urlContextMetadataList) {
    if (!ucm) continue;
    for (const entry of ucm.urlMetadata) {
      if (!entry.retrievedUrl) continue;
      const isSuccess = entry.status === "URL_RETRIEVAL_STATUS_SUCCESS";
      // 一度でも成功していれば成功を優先する。
      const existing = statusByUrl.get(entry.retrievedUrl);
      if (existing === "success") continue;
      statusByUrl.set(entry.retrievedUrl, isSuccess ? "success" : "error");
    }
  }

  return sourceRegistry.map((entry) => {
    const status = statusByUrl.get(entry.grounding_redirect_url);
    if (!status || status === entry.url_context_status) return entry;
    return { ...entry, url_context_status: status };
  });
}

/* ------------------------------------------------------------------ */
/*  最終統合                                                             */
/* ------------------------------------------------------------------ */

export interface FinalizeParams {
  aiItems: readonly ResearchItem[];
  nonAiItems: readonly ResearchItem[];
  sourceRegistry: readonly SourceRegistryEntry[];
  placesVerifiedKeys?: ReadonlySet<string>;
  /** Tier B判定に使うSearchFact(feat/ai-research-quality-refinement)。 */
  searchFacts?: readonly SearchFact[];
}

/**
 * Stage2(AI対象項目)/ HEARING系項目を統合し、deterministic validation
 * (`applyDeterministicValidation`, PR1)を適用した最終結果を返す。
 */
export function finalizeResearchItems(params: FinalizeParams): ResearchItem[] {
  const { aiItems, nonAiItems, sourceRegistry, placesVerifiedKeys, searchFacts } = params;
  const merged = [...aiItems, ...nonAiItems];
  return merged.map((item) =>
    applyDeterministicValidation(item, { sourceRegistry, placesVerifiedKeys, searchFacts }),
  );
}

export type { GroundingMetadataLike, SearchNote };
