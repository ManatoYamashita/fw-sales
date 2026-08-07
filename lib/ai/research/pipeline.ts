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
  deriveDisplaySourceName,
  type IdentityStatus,
  type ResearchItem,
  type SearchFact,
  type SourceRegistryEntry,
  type SourceType,
  type SourceVerification,
} from "@/lib/ai/research-result-schema";
import { isAddressMatch, isNameMatch, isTargetStoreMatch } from "./identity-match";
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
  /**
   * per-source identity verification(fix/ai-research-source-identity-integrity)。
   * `applySourceIdentityVerification`でSource Registryの`identity_status`へ反映する。
   */
  sourceVerifications: SourceVerification[];
}

/**
 * `Stage2InvalidOutputError`の失敗カテゴリ。`workflows/store-research.ts`の
 * `classifyForWorkflowRetry`が`error_kind`(`stage2_invalid_output:${kind}`)へ
 * そのまま反映する。DB(`store_research_runs.error_kind`)を見るだけで4分類が
 * 判別できるようにするための機械可読トークンであり、生のGemini応答やユーザー入力
 * とは無関係の固定値のみを取る(実機Preview検証、2026-08-07で発生した
 * `fatal:stage2_invalid_output`が具体的にどの検証で落ちたか、DBからは判別
 * できなかった事象への対応)。
 */
export type Stage2InvalidOutputKind = "json_parse" | "schema" | "coverage" | "identity";

/**
 * Stage2の応答がJSON parse・schema検証・件数/key集合の一致(coverage)・店舗同定の
 * いずれかで失敗したことを表すsanitizedなエラー(feat/ai-research-pre-smoke-hardening、
 * BLOCKER1)。
 *
 * 旧実装は失敗時に`items: []` + `parseWarning`を返し例外を投げなかったため、
 * Stage2が丸ごと失敗してもWorkflowはsucceededとして保存できてしまっていた
 * (HEARING_ONLY/EXTERNAL_DATA_REQUIRED項目とPlaces由来項目のみの「成功」結果に
 * なる)。本クラスを投げることで`stage2Step`(workflows/store-research.ts)が
 * `classifyForWorkflowRetry`経由でfailedへ倒す。message には生のGemini応答本文を
 * 一切含めない(sanitizedなreasonのみ)。自動的なGemini再callは追加しない
 * (ユーザーが再調査を選べればよい、という既存方針を維持)。
 */
export class Stage2InvalidOutputError extends Error {
  readonly kind: Stage2InvalidOutputKind;

  constructor(message: string, kind: Stage2InvalidOutputKind) {
    super(message);
    this.name = "Stage2InvalidOutputError";
    this.kind = kind;
  }
}

/**
 * Stage2応答のcoverage(件数・key集合・重複)を検証する(feat/ai-research-pre-smoke-hardening、
 * BLOCKER1)。期待件数は常にそのrunの`allowedKeys.length`から動的に導出し、
 * 固定値をハードコードしない。
 */
function validateStage2Coverage(
  items: readonly { key: string }[],
  allowedKeys: readonly string[],
): string | null {
  const keys = items.map((i) => i.key);
  const keySet = new Set(keys);
  if (keys.length !== keySet.size) {
    return "重複したkeyが含まれていました";
  }
  const allowedKeySet = new Set(allowedKeys);
  if (keys.length !== allowedKeys.length || keys.some((k) => !allowedKeySet.has(k))) {
    return `期待されるkey集合(${allowedKeys.length}件)と一致しませんでした(実際: ${keys.length}件)`;
  }
  return null;
}

/**
 * Stage2: AI対象項目(FACT + FACT_OR_HEARING + ANALYSIS、そのrunで実際に選択された件数)を
 * 1回のGemini呼出で生成する(fix/ai-research-poc-like-retrieval、PoCと同様の単一call構成へ回帰)。
 *
 * JSON parse失敗・schema検証失敗・coverage不一致のいずれかが発生した場合、
 * `Stage2InvalidOutputError`を投げる(feat/ai-research-pre-smoke-hardening、BLOCKER1、
 * 「部分成功」としてsucceededにしない)。
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
    throw new Stage2InvalidOutputError("Stage2の応答をJSONとして解釈できませんでした。", "json_parse");
  }

  const zodSchema = buildStage2ResponseZodSchema(allowedKeys, registryIds);
  const parsed = zodSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new Stage2InvalidOutputError("Stage2の応答がスキーマに準拠しませんでした。", "schema");
  }

  const resultItems = parsed.data.items as ResearchItem[];
  const coverageError = validateStage2Coverage(resultItems, allowedKeys);
  if (coverageError !== null) {
    throw new Stage2InvalidOutputError(`Stage2の応答が不完全でした: ${coverageError}`, "coverage");
  }

  // FIX12(fix/ai-research-source-identity-integrity): run全体のstore_identificationが
  // 対象店舗と名前・住所のいずれも明確に不一致な場合、Stage2全体が別店舗を調査して
  // しまった疑いが強いため succeeded として保存しない。ただしこれはあくまで粗い
  // safety netであり、個別sourceの`identity_status`判定(`applySourceIdentityVerification`)
  // を代替しない。false positiveでrunを無駄に失敗させないよう、name/addressの**両方**が
  // 明確に不一致の場合のみ発火する(片方が空・不明な場合は発火しない)。
  const identification = parsed.data.store_identification;
  const nameLooksUnrelated =
    identification.matched_name.trim() !== "" && !isNameMatch(identification.matched_name, store.name);
  const addressLooksUnrelated =
    identification.matched_address.trim() !== "" &&
    !isAddressMatch(identification.matched_address, store.address);
  if (nameLooksUnrelated && addressLooksUnrelated) {
    throw new Stage2InvalidOutputError(
      "店舗同定に失敗しました(store_identification_mismatch)",
      "identity",
    );
  }

  return {
    items: resultItems,
    urlContextMetadata: result.urlContextMetadata,
    usageMetadata: result.usageMetadata,
    sourceVerifications: parsed.data.source_verifications as SourceVerification[],
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

/**
 * `derivePlacesVerifiedKeys`が返しうる最大6key(store_name/address/cuisine_genre/phone/
 * review_avg/review_count)から、`finalizeResearchItems`のtrust boundary
 * (`validateResearchItemStatus`の`placesVerifiedKeys`)へ渡してよい集合を導出する
 * (feat/ai-research-final-audit-hardening、監査で発見したテストカバレッジの欠落を修正)。
 *
 * この絞り込みはBLOCKER2(値の中身を見ずにkey一致だけでstore_name/address/
 * cuisine_genre/phoneがconfirmed維持されてしまうバグ)の修正そのものであり、
 * 以前は`workflows/store-research.ts`の中に直接インライン実装されていたため、
 * Vercel Workflow自体は統合テストで丸ごとmockされ、この1行の絞り込みロジックには
 * 単体テストが存在しなかった(将来のリファクタで`placesVerifiedKeySet`をそのまま
 * 渡すよう変更されても検知できない状態だった)。純関数として切り出しテスト可能にする。
 */
export function deriveDeterministicPlacesConfirmedKeys(
  placesVerifiedKeys: ReadonlySet<string>,
): Set<string> {
  return new Set(
    [...placesVerifiedKeys].filter((key) =>
      (DETERMINISTIC_PLACES_KEYS as readonly string[]).includes(key),
    ),
  );
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

/** `identity_note`の最大文字数(prompt/DB肥大化防止、他のSearch Note系フィールドと同じ方針)。 */
const MAX_IDENTITY_NOTE_LENGTH = 200;

/**
 * Stage2の`source_verifications`(モデル自己申告のrelation + 実際に観測した店舗名/住所/電話)を
 * StoreIdentityとコード側で突合し、Source Registryへ`identity_status`/`identity_note`として
 * 反映する(fix/ai-research-source-identity-integrity、FIX3・FIX4)。
 *
 * `relation==="target_store"`の自己申告は無条件に信用せず、`isTargetStoreMatch`
 * (`places-stage0.ts`のText Search fallbackと同じ「店名一致 AND (住所一致 OR 電話一致)」
 * 基準)が成立した場合のみ`target_match`にする。成立しない場合は`uncertain`へ倒す
 * (false positiveよりfalse negativeを優先。今回の実機smoke事故=誤ったHotPepper URLが
 * 「target_store」と自己申告されても、observed_name/addressが対象店舗と一致しなければ
 * ここで弾かれる)。
 *
 * `competitor`/`contextual`/`unrelated`/`uncertain`はモデル自己申告をそのまま
 * `identity_status`へ反映する(競合店舗の正解データを持たないため、target_matchと
 * 同等の強度のコード側検証はできない。§FIX3参照)。
 *
 * 純関数。入力を変更せず、新しい配列を返す。
 */
export function applySourceIdentityVerification(
  sourceRegistry: readonly SourceRegistryEntry[],
  sourceVerifications: readonly SourceVerification[],
  store: StoreIdentity,
): SourceRegistryEntry[] {
  const verificationById = new Map<string, SourceVerification>();
  for (const v of sourceVerifications) {
    // 捏造・未知IDはSource Registry側の集合に存在しないため以下のmapで自然に無視される。
    // 同一source_idの重複報告は先勝ちで採用する(existing conflictShape等と同じ方針)。
    if (!verificationById.has(v.source_id)) verificationById.set(v.source_id, v);
  }

  return sourceRegistry.map((entry) => {
    const verification = verificationById.get(entry.id);
    if (!verification) return entry;

    const identityStatus = deriveIdentityStatusFromVerification(verification, store);
    const note =
      verification.note.length > MAX_IDENTITY_NOTE_LENGTH
        ? `${verification.note.slice(0, MAX_IDENTITY_NOTE_LENGTH)}…`
        : verification.note;

    return { ...entry, identity_status: identityStatus, identity_note: note };
  });
}

function deriveIdentityStatusFromVerification(
  verification: SourceVerification,
  store: StoreIdentity,
): IdentityStatus {
  switch (verification.relation) {
    case "target_store":
      return isTargetStoreMatch(
        {
          name: verification.observed_name,
          address: verification.observed_address,
          phone: verification.observed_phone,
        },
        store,
      )
        ? "target_match"
        : "uncertain";
    case "competitor":
      return "competitor_match";
    case "contextual":
      return "contextual";
    case "unrelated":
      return "unrelated";
    case "uncertain":
      return "uncertain";
  }
}

/* ------------------------------------------------------------------ */
/*  own_net_exposure / media_coverage の post-Stage2 deterministic補正      */
/*  (feat/ai-research-final-quality)                                       */
/* ------------------------------------------------------------------ */

/**
 * Stage2プロンプト構築時点(`buildStage2Prompt`呼出時)では、そのrun自身のURL Context
 * 結果がまだ存在しない(Stage2実行前)ため、「実際に確認できたWeb露出」をプロンプトへ
 * 含める設計は原理的に機能しない(常に空になる、fix/ai-research-quality-refinementで
 * 導入し feat/ai-research-final-quality で撤去した"Observed Web Presence"ブロックの
 * バグ)。この関数はStage2完了後の`finalRegistry`(url_context_status反映済み)から
 * 実際に本文取得へ成功した情報源を求め、`own_net_exposure`/`exposure_gap`のevidenceへ
 * 補足として追記する。追加のGemini呼出は行わない(deterministicな後処理のみ)。
 */
export function appendConfirmedMediaContext(
  items: readonly ResearchItem[],
  finalRegistry: readonly SourceRegistryEntry[],
): ResearchItem[] {
  // MAJOR9(feat/ai-research-pre-smoke-hardening): url_context_status==="success"というだけで
  // 無条件に列挙すると、competitor/public_data/other等の自店と無関係なsourceが
  // 「確認できた掲載媒体」として own_net_exposure/exposure_gap のvalueへ混入する。
  // media_coverage側と同じ`MEDIA_COVERAGE_SOURCE_TYPES`で絞り込む。
  // fix/ai-research-source-identity-integrity(FIX10): さらに`identity_status===
  // "target_match"`も必須にする(url_context成功=ページ取得成功であって対象店舗の
  // ページだったことを保証しない、実機smoke事故の教訓)。表示名も`entry.title`
  // (モデル自己申告)ではなく`deriveDisplaySourceName`でhostnameから導出する(FIX9)。
  const confirmedNames = Array.from(
    new Set(
      finalRegistry
        .filter(
          (entry) =>
            entry.url_context_status === "success" &&
            entry.identity_status === "target_match" &&
            MEDIA_COVERAGE_SOURCE_TYPES.has(entry.source_type),
        )
        .map((entry) => deriveDisplaySourceName(entry)),
    ),
  );
  if (confirmedNames.length === 0) return items.slice();

  const targetKeys = new Set(["own_net_exposure", "exposure_gap"]);
  const mediaList = confirmedNames.join("、");
  const evidenceSupplement = `(このrunで実際に本文を確認できた情報源: ${mediaList})`;
  // FACT部分(掲載媒体名)をvalueの先頭にdeterministicに配置する(feat/ai-research-final-trust-boundary)。
  // AIのANALYSIS文章自体(推論・評価の部分)は維持するが、「どの媒体に掲載されているか」という
  // 事実部分をAIの自由記述に委ねず、finalRegistryの実測値で先頭に明示することで、
  // 「実際は確認できたのに未掲載/伸びしろありと矛盾して述べる」リスクを下げる。
  const factPrefix = `確認できた掲載媒体: ${mediaList}。`;

  return items.map((item) => {
    if (!targetKeys.has(item.key)) return item;
    return {
      ...item,
      value: item.value ? `${factPrefix} ${item.value}` : item.value,
      evidence: `${item.evidence} ${evidenceSupplement}`,
    };
  });
}

/** `media_coverage`の「確認できた掲載媒体」対象source_type(公式サイト・SNSは自店発信のため除く)。 */
const MEDIA_COVERAGE_SOURCE_TYPES: ReadonlySet<SourceType> = new Set([
  "gourmet_site",
  "reservation_site",
  "article",
  "local_official",
]);

/**
 * `media_coverage`のvalue/evidence/source_idsを、実際に検証できた第三者媒体
 * (グルメサイト・予約サイト・地域記事等)からdeterministicに構築する
 * (feat/ai-research-final-trust-boundary、fix/ai-research-source-identity-integrity
 * でFIX10として再設計)。
 *
 * 発見された実バグ(feat/ai-research-final-trust-boundary): AIが`confirmed`と判定した場合、
 * 旧実装は「モデル自身の判断を尊重」してAIの`value`テキストをそのまま素通ししていたが、
 * `value`は`source_ids`とは独立した自由文字列であり、`pruneUnverifiedSourceIds`による
 * `source_ids`配列の刈り込みでは`value`テキスト自体は一切修正されない。そのため
 * 「実際に検証できたのは2媒体なのにvalueには5媒体が列挙されている」という不整合が
 * 起きていた。
 *
 * 実機smokeで発見した2件目のバグ(fix/ai-research-source-identity-integrity): 上記の
 * 「検証済み」の定義が`url_context_status==="success"`(または信頼済みhostnameの
 * SearchFact一致)のみであり、「取得したページが実際に対象店舗の掲載ページだったか」を
 * 一切確認していなかった。信頼済みhostname(hotpepper.jp等)であっても、実際には全く
 * 別店舗のページを指すURLが「確認できた掲載媒体」として列挙される事故が発生した。
 *
 * 対応: 検証済み媒体の定義を「(1) url_context成功 かつ (2) `identity_status===
 * "target_match"`(Stage2の`source_verifications`とStoreIdentityの突合で確認済み)」の
 * 両方を満たす場合に限定する。SearchFactのみ(url_context未成功)の経路は廃止した
 * (`validateResearchItemStatus`の`isTierBEligible`と同じ方針、known_store_data以外の
 * SearchFact-onlyエビデンスはtarget項目のconfirmedに使わない、FIX6)。
 *
 * `value`の表示名は`deriveDisplaySourceName`でhostnameからdeterministicに導出し、
 * モデル自己申告の`entry.title`には依存しない(FIX9、モデルtitleと実際のURLが
 * 食い違っていた実機事故の再発防止)。
 */
export function upgradeMediaCoverageFromRegistry(
  items: readonly ResearchItem[],
  finalRegistry: readonly SourceRegistryEntry[],
): ResearchItem[] {
  const verifiedMedia = finalRegistry.filter(
    (entry) =>
      MEDIA_COVERAGE_SOURCE_TYPES.has(entry.source_type) &&
      entry.url_context_status === "success" &&
      entry.identity_status === "target_match",
  );
  if (verifiedMedia.length === 0) return items.slice();

  const displayNames = Array.from(new Set(verifiedMedia.map((entry) => deriveDisplaySourceName(entry))));

  return items.map((item) => {
    if (item.key !== "media_coverage") return item;
    return {
      ...item,
      status: "confirmed" as const,
      value: displayNames.join("、"),
      evidence: "実際に確認できた掲載媒体を列挙しています。",
      source_ids: verifiedMedia.map((entry) => entry.id),
      evidence_basis: "url_context" as const,
      warning: undefined,
      candidates: undefined,
    };
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
