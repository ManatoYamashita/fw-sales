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
import {
  buildSourceRegistry,
  parseSearchNotes,
  hasTabelogSourceBlock,
  sourceBlocksMentionTabelogDomain,
  type GroundingMetadataLike,
  type SearchNote,
} from "./source-registry";
import { buildStage1Prompt, buildStage2Prompt, selectAiResearchItems, type StoreIdentity } from "./prompts";
import { buildStage2JsonSchema, buildStage2ResponseZodSchema } from "./schema-builder";
import {
  createResearchGeminiClient,
  type Stage2RequestShape,
  type UsageMetadataLike,
  type UrlContextMetadataLike,
} from "./client";
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
import {
  deriveSearchIdentityName,
  isAddressMatch,
  isNameMatch,
  isTargetStoreMatch,
  normalizePhone,
} from "./identity-match";
import type { VerifiedPlacesIdentity } from "./places-stage0";
import {
  CANONICAL_EVIDENCE_BASIS,
  CANONICAL_FALLBACK_KEYS,
  isCanonicalFallbackAllowed,
} from "./evidence-precedence";
import { deriveFreshPlacesVerifiedKeys } from "./places-verified";
import { normalizeUrlForMatch } from "./url-normalize";
import {
  enforcePhoneNumbersBackedByEvidence,
  isConflictCandidateEvidenceBacked,
} from "./phone-evidence";
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
   * 食べログ検索の mandatory attempt を実際に行ったか(診断用、PR #180 BLOCKER 1)。
   * 判定は `client.ts` が server-side tool invocation の `args.queries` から行い、
   * ここへ届く時点で既に boolean 化されている(raw query は保持しない)。
   * `false` でも run を失敗させない(observability のみ)。
   */
  tabelogSearchAttempted: boolean;
  /**
   * 既存 `parseSourceBlocks` が読み取れた `[SOURCE]` に食べログURLが含まれたか
   * (診断用、PR #180)。`tabelogSearchAttempted` が「検索を実行したか」なのに対し、
   * こちらは「モデルが SOURCE として出力したか」。
   */
  tabelogSourceEmitted: boolean;
  /**
   * `[SOURCE]…[/SOURCE]` の body 内部に食べログドメインのURL言及があったか(診断用)。
   * `tabelogSourceEmitted === false` かつ本値が `true` なら、モデルは SOURCE ブロック内へ
   * 書いたが既存 parser の要求形式(`url:` 行)を満たさなかったことを意味する。
   * いずれの値も run の成否・Source Registry の選択・prompt には影響しない。
   */
  tabelogSourceBlockMentionsDomain: boolean;
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
    tabelogSearchAttempted: result.tabelogSearchAttempted,
    // 診断値のみ。Source Registry の構築結果には影響させない(上の buildSourceRegistry は
    // これらの値を一切参照しない)。応答テキストは boolean 化した時点で捨て、永続化しない。
    tabelogSourceEmitted: hasTabelogSourceBlock(result.text),
    tabelogSourceBlockMentionsDomain: sourceBlocksMentionTabelogDomain(result.text),
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
  /**
   * run 全体の `store_identification` 粗照合の結果。`mismatch` が true の場合、
   * `workflows/store-research.ts` が warning として記録する(以前はここで
   * run 全体を failed にしていた。理由は `runStage2` 内のコメント参照)。
   */
  identity: Stage2IdentityDiagnostic;
}

/**
 * Stage2 の `store_identification` 粗照合の **sanitized な結果**
 * (PR #180 post-merge smoke、Finding B)。
 *
 * ## なぜ boolean だけなのか
 *
 * 以前この照合は失敗時に `Stage2InvalidOutputError("identity")` を投げるだけで、
 * **どこにも診断が残らなかった**。`runStructuredUrlContext` が成功した**後**に
 * throw するため `logGeminiCallFailure` を通らず、`persistFailedRun` が書くのは
 * `error_kind` のみ。Stage1 には `stage1_diagnostics`、Stage2 の 400 には
 * `Stage2RequestShape` があるのに、identity だけ観測点が無く、実機で発生した際は
 * 店舗レコードから因果を逆算する必要があった。
 *
 * 既存の `Stage1Diagnostics` / `Stage2RequestShape` と同じ規約に従い、**count と
 * boolean のみ**を持つ。モデルが報告した店名・住所の文字列そのものは載せない
 * (型として持てない)。
 */
export interface Stage2IdentityDiagnostic {
  /** `matched_name` が非空で報告されたか。 */
  name_reported: boolean;
  /** `matched_address` が非空で報告されたか。 */
  address_reported: boolean;
  /** 報告された店名が対象店舗と一致したか(未報告なら false)。 */
  name_matched: boolean;
  /** 報告された住所が対象店舗と一致したか(未報告なら false)。 */
  address_matched: boolean;
  /** 店名・住所の**両方**が報告され、かつ両方とも不一致だったか。 */
  mismatch: boolean;
}

/**
 * `Stage2InvalidOutputError`の失敗カテゴリ。`workflows/store-research.ts`の
 * `classifyForWorkflowRetry`が`error_kind`(`stage2_invalid_output:${kind}`)へ
 * そのまま反映する。DB(`store_research_runs.error_kind`)を見るだけで4分類が
 * 判別できるようにするための機械可読トークンであり、生のGemini応答やユーザー入力
 * とは無関係の固定値のみを取る(実機Preview検証、2026-08-07で発生した
 * `fatal:stage2_invalid_output`が具体的にどの検証で落ちたか、DBからは判別
 * できなかった事象への対応)。
 *
 * `"identity"` は **現在のコードからは生成されない**(PR #180 post-merge smoke で
 * hard fail から warning へ変更した。理由は `runStage2` 内のコメント参照)。
 * 過去 run の `error_kind = "fatal:stage2_invalid_output:identity"` を
 * `workflows/store-research.ts` の `SANITIZED_KIND_PATTERN` が引き続き解釈できる
 * よう、union と正規表現の両方に**意図的に残している**。
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
 * Stage2 request の **sanitized な形状診断**(count のみ)を構造化入力から組み立てる
 * (PR #180、Stage2 400 INVALID_ARGUMENT observability)。
 *
 * ## なぜ prompt テキストから逆算しないのか
 *
 * URL 件数・項目件数・Search Note 件数はいずれも構造化データ(`allowedKeys` /
 * `sourceRegistry` / `searchNotes`)として手元にある。prompt を正規表現で
 * 走査して数え直すと、prompt 書式の変更で静かに壊れるうえ、URL 断片を
 * 取り回す実装になり漏洩面が増える。構造化入力から直接数える。
 *
 * ## Search Note の件数
 *
 * `buildStage2Prompt` は `sourceRegistry` の `grounding_redirect_url` と一致する
 * note だけを prompt へ埋め込む(一致しない URL は出典として引用できないため)。
 * ここでも同じ条件で数え、**実際に prompt に入る件数**を返す。
 *
 * ## 不変条件
 *
 * 戻り値は number のみ。URL・prompt・schema 本文・店舗名・住所・電話番号を
 * 1つも含まない(型として持てない)。純関数で、入力を変更しない。
 */
export function buildStage2RequestShape(params: {
  allowedKeys: readonly string[];
  sourceRegistry: readonly SourceRegistryEntry[];
  searchNotes: readonly SearchNote[];
  jsonSchema: Record<string, unknown>;
}): Stage2RequestShape {
  const { allowedKeys, sourceRegistry, searchNotes, jsonSchema } = params;

  const urls = sourceRegistry.map((s) => s.grounding_redirect_url);
  let invalidUrlCount = 0;
  for (const url of urls) {
    try {
      new URL(url);
    } catch {
      invalidUrlCount += 1;
    }
  }

  const registryUrls = new Set(urls);
  const searchNoteCount = searchNotes.filter((n) => registryUrls.has(n.sourceUrl)).length;

  return {
    stage2_item_count: allowedKeys.length,
    source_registry_count: sourceRegistry.length,
    unique_url_count: registryUrls.size,
    invalid_url_count: invalidUrlCount,
    search_note_count: searchNoteCount,
    schema_utf8_byte_count: new TextEncoder().encode(JSON.stringify(jsonSchema)).length,
  };
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

  const result = await client.runStructuredUrlContext(
    {
      prompt,
      jsonSchema,
      // 失敗時ログ専用の sanitized な request 診断(count のみ、PR #180)。
      // request 本体(prompt / jsonSchema / config)には一切影響しない。
      diagnostics: buildStage2RequestShape({
        allowedKeys,
        sourceRegistry,
        searchNotes,
        jsonSchema,
      }),
    },
    signal,
  );

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
  // しまった疑いが強い。ただしこれはあくまで粗い safety netであり、個別sourceの
  // `identity_status`判定(`applySourceIdentityVerification`)を代替しない。
  //
  // ## hard fail から warning へ変更した理由(PR #180 post-merge smoke、Finding A)
  //
  // 「name/addressの**両方**が不一致のときだけ発火」という false positive 対策は、
  // 両者が**独立に**壊れることを前提にしている。しかし実機では、この前提が成立しない
  // common-mode failure が見つかった:
  //
  //   `lib/places/google.ts` の Place Details 呼び出しに言語指定が無く、英語表記の
  //   店名・住所が `stores` に保存される。すると `isNameMatch` と `isAddressMatch` が
  //   **同時に** false になり、正しい店舗を調べていても必ず両方不一致になる。
  //
  // この状態の店舗は run が毎回 failed になり、ユーザーからは「理由不明の恒久失敗」に
  // しか見えない(診断も残らなかった。`Stage2IdentityDiagnostic` の JSDoc 参照)。
  // 粗い safety net が「別店舗を調査した」と「こちらの登録住所がローマ字」を区別
  // できない以上、run 全体を失わせる trade は割に合わない。
  //
  // **二重防御は維持している。** 別店舗のデータが `confirmed` になる経路は、個別
  // source の `identity_status`(`applySourceIdentityVerification` /
  // `isVerifiedSourceForItem`)が従来どおり塞ぐ。ここは warning を出して人間が
  // 出典を確認できるようにするだけに徹する。
  //
  // 判定には `deriveSearchIdentityName` を通した店名を使う(`isTargetStoreMatch` と
  // 同じ基準)。生の `store.name` は「（確バツ）〇〇」のような営業管理タグを含みうるが、
  // モデルが報告する `matched_name` は実店舗名であり、包含判定頼みで不安定だった。
  const identification = parsed.data.store_identification;
  const identityName = deriveSearchIdentityName(store.name);
  const nameReported = identification.matched_name.trim() !== "";
  const addressReported = identification.matched_address.trim() !== "";
  const nameMatched = nameReported && isNameMatch(identification.matched_name, identityName);
  const addressMatched =
    addressReported && isAddressMatch(identification.matched_address, store.address);

  return {
    items: resultItems,
    urlContextMetadata: result.urlContextMetadata,
    usageMetadata: result.usageMetadata,
    sourceVerifications: parsed.data.source_verifications as SourceVerification[],
    identity: {
      name_reported: nameReported,
      address_reported: addressReported,
      name_matched: nameMatched,
      address_matched: addressMatched,
      mismatch: nameReported && addressReported && !nameMatched && !addressMatched,
    },
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
 * 店舗名/住所/業種/電話番号を対象外とするのは、Placesで一律上書きすると電話番号の
 * roleの違い(店舗直通/予約専用等、Stage2プロンプトの較正対象)のような有用な情報を
 * 失うリスクがあるため。
 *
 * なお、この4項目は`placesVerifiedKeys`バイパス経由でもconfirmedにならない。
 * `deriveDeterministicPlacesConfirmedKeys`(BLOCKER2の修正)が
 * trust boundaryへ渡す集合を本定数の2keyへ絞り込むためである
 * (以前のコメントは「Gemini + placesVerifiedKeysバイパスで既にconfirmedできている」と
 * 記述していたが、絞り込み導入時点で事実と乖離していた。PR #180監査で発見、
 * コメントのみ修正し挙動は変更していない)。この4項目をPlaces由来でconfirmedにするかは
 * 別途の設計判断とする。
 * `review_avg`/`review_count`はWeb調査でGeminiが正確に再現しづらく(Google公式評価を
 * 直接掲載する第三者サイトが少ない)、Places側で確定できるなら常にそちらを優先すべき
 * 数少ない項目のため、この2keyに限定してGemini対象からも除外する
 * (`runStage2`の`excludeKeys`と対で使う)。
 */
export const DETERMINISTIC_PLACES_KEYS = ["review_avg", "review_count"] as const;

/**
 * **このrunのStage0がGoogle Placesから実際に取得した**`review_avg`/`review_count`から、
 * AI呼出無しでconfirmedなResearchItemを直接合成する。
 *
 * ## fresh 起点へ変更した理由(feat/ai-research-quality-ux-hardening、Plan §6.1)
 *
 * 以前は `mergeBasicInfo` **通過後**の `effectiveBasicInfo` を入力にしていた。
 * `mergeBasicInfo` の manual 保護(`lib/domain/basic-info-merge.ts:88`)は
 * canonical DB を守るための正しい規則だが、DBへ書かないin-memory経路にも等しく効くため、
 * 「Placesが今 4.4 と答えている」という事実が保護規則によって破棄されていた。
 * さらに review での採用が `filled_by:"manual"` を書く
 * (`lib/domain/research-review.ts:246`)ため、**正しく運用するほど品質が下がる**
 * 自己増悪ループになっていた(実機事象: 炉端ジュンの review_avg / review_count)。
 *
 * 本関数は canonical をまったく参照しないため、canonical 側の manual 保護を
 * **1ミリも変更せずに**この経路だけを切り離せる。
 *
 * @param freshPlacesBasicInfo    `runStage0PlacesResync` が返す `placesBasicInfo`(生の Stage0 結果)
 * @param freshPlacesVerifiedKeys `deriveFreshPlacesVerifiedKeys` の結果
 * @param canonicalBasicInfo      差異検出用(任意)。値の採用には使わず、warning にのみ使う
 */
export function buildDeterministicPlacesItems(
  freshPlacesBasicInfo: Partial<BasicInfo>,
  freshPlacesVerifiedKeys: ReadonlySet<string>,
  canonicalBasicInfo?: BasicInfo,
): ResearchItem[] {
  const items: ResearchItem[] = [];
  for (const key of DETERMINISTIC_PLACES_KEYS) {
    if (!freshPlacesVerifiedKeys.has(key)) continue;
    const field = freshPlacesBasicInfo[key];
    if (!field?.value) continue;

    // fresh を採用したうえで、canonical と食い違う場合だけ人間の判断材料を添える
    // (canonical は書き換えない。採用するかどうかは review の人間判断に委ねる)。
    const canonicalValue = canonicalBasicInfo?.[key]?.value ?? null;
    const diverged =
      canonicalValue !== null &&
      canonicalValue.trim() !== "" &&
      canonicalValue.trim() !== field.value.trim();

    items.push({
      key,
      research_policy: getResearchPolicy(key)!,
      status: "confirmed",
      value: field.value,
      evidence: "今回の調査時点のGoogle Placesで確認した値です。",
      source_ids: [],
      confidence: 100,
      evidence_basis: "places",
      ...(diverged
        ? {
            warning: `登録済みの値(${canonicalValue})と今回のGoogle Places値(${field.value})が異なります。`,
          }
        : {}),
    });
  }
  return items;
}

/**
 * canonical `stores.basic_info` を根拠に、fresh で取得できなかった項目を
 * **「今回は再確認できていない既知情報」として**合成する
 * (feat/ai-research-quality-ux-hardening、Plan §7)。
 *
 * ## 何を解決するか
 *
 * アプリが既に確定情報を持っているのに、再調査のたびに `not_found` へ退化していた
 * (実機事象: 炉端ジュンの `official_site`。canonical に値があるのに Research result は
 * 「確認できず」)。Research pipeline が `stores.basic_info` を読む経路が
 * deterministic Places item 生成の1本しか無かったことが原因。
 *
 * ## fresh と偽装しないための担保
 *
 * - `evidence` に「今回のWeb再確認はできていません」と `updated_at`(YYYY-MM-DD)を必ず含める
 * - `evidence_basis` は `existing_canonical`(UI の source badge で fresh と区別する)
 * - `confidence` は `null`(AIの確信度を騙らない)
 * - `source_ids` は `[]`(存在しない出典URLを帰属させない)
 *
 * ## 対象を狭く保つ
 *
 * `CANONICAL_FALLBACK_KEYS`(3項目)のみ。全項目へ広げると Research result が
 * 「調査」ではなく「既存値のエコー」になる。`official_site` は
 * **human-reviewed(`filled_by==="manual"`)のみ**を対象とし、
 * `stores.site_url` が非空なだけでは confirmed にしない(承認レビュー指摘1)。
 * `stores.site_url` は従来どおり Source Registry へ `known_store_data` として
 * seed されるだけである。
 *
 * @param canonicalBasicInfo 店舗の canonical `basic_info`
 * @param alreadyProvidedKeys fresh 経路で既に item を合成済みの key(重複合成を避ける)
 */
export function buildCanonicalFallbackItems(
  canonicalBasicInfo: BasicInfo,
  alreadyProvidedKeys: ReadonlySet<string>,
): ResearchItem[] {
  const items: ResearchItem[] = [];
  for (const key of CANONICAL_FALLBACK_KEYS) {
    if (alreadyProvidedKeys.has(key)) continue;
    const field = canonicalBasicInfo[key];
    if (!isCanonicalFallbackAllowed(key, field)) continue;
    items.push({
      key,
      research_policy: getResearchPolicy(key)!,
      status: "confirmed",
      value: field!.value,
      evidence: `登録済みの基本情報として保持されている値です(最終更新 ${toDateOnly(field!.updated_at)})。今回のWeb再確認はできていません。`,
      source_ids: [],
      confidence: null,
      evidence_basis: CANONICAL_EVIDENCE_BASIS,
    });
  }
  return items;
}

/**
 * `buildCanonicalFallbackItems` が**実際に合成した** item の key 集合を返す。
 * `finalizeResearchItems` の `canonicalVerifiedKeys` へはこの結果だけを渡すこと
 * (`deriveDeterministicPlacesConfirmedKeys` と同じ「合成した分だけ渡す」規約)。
 */
export function deriveCanonicalFallbackConfirmedKeys(
  canonicalItems: readonly ResearchItem[],
): Set<string> {
  return new Set(canonicalItems.map((item) => item.key));
}

/** ISO 8601 の `updated_at` を表示用の `YYYY-MM-DD` にする(不正値はそのまま返す)。 */
function toDateOnly(isoLike: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(isoLike) ? isoLike.slice(0, 10) : isoLike;
}

export interface DeterministicItemsInput {
  /** `runStage0PlacesResync` が返した生の Stage0 結果(canonical とマージしないこと)。 */
  freshPlacesBasicInfo: Partial<BasicInfo>;
  /** 店舗の canonical `basic_info`。fallback と差異警告にのみ使う。 */
  canonicalBasicInfo: BasicInfo;
}

export interface DeterministicItemsResult {
  /** Stage2 の `aiItems` へ合流させる deterministic item。 */
  items: ResearchItem[];
  /** trust boundary(`placesVerifiedKeys`)へ渡してよい key(BLOCKER2 の絞り込み済み)。 */
  placesConfirmedKeys: Set<string>;
  /** trust boundary(`canonicalVerifiedKeys`)へ渡してよい key。 */
  canonicalConfirmedKeys: Set<string>;
  /** Stage2 の `excludeKeys` へ渡す key(= 合成した全 item の key)。 */
  deterministicKeys: string[];
}

/**
 * Stage0 の結果と canonical から deterministic item 一式を導出する
 * (feat/ai-research-quality-ux-hardening、Plan §6 / §7、Q18)。
 *
 * ## なぜ純関数として切り出すのか
 *
 * 実機バグ(Q1)の発生地点は `workflows/store-research.ts` の
 * 「`mergeBasicInfo` を通した結果から Places 検証済み key を導く」という
 * **2行の相互作用**だった。Workflow 本体は統合テストで丸ごと mock されるため、
 * この相互作用には単体テストが1本も存在せず、誰も検知できなかった。
 * `deriveDeterministicPlacesConfirmedKeys` が同じ理由で純関数化された前例に倣い、
 * データフロー全体をテスト可能な1つの純関数へ集約する。
 *
 * ## 責務分離(この関数が守る不変条件)
 *
 * - fresh evidence は **canonical をまったく参照せずに**導出する
 *   (canonical の manual 保護が fresh を破棄しない)
 * - canonical fallback は fresh で埋まらなかった key にのみ適用する
 * - trust boundary へ渡す key 集合は「実際に合成した item」から導く
 *   (key の推測で bypass を与えない)
 *
 * 純関数。入力を変更しない。
 */
export function buildDeterministicItems(
  input: DeterministicItemsInput,
): DeterministicItemsResult {
  const { freshPlacesBasicInfo, canonicalBasicInfo } = input;

  const freshPlacesVerifiedKeys = deriveFreshPlacesVerifiedKeys(freshPlacesBasicInfo);
  const placesItems = buildDeterministicPlacesItems(
    freshPlacesBasicInfo,
    freshPlacesVerifiedKeys,
    canonicalBasicInfo,
  );
  const placesConfirmedKeys = deriveDeterministicPlacesConfirmedKeys(freshPlacesVerifiedKeys);

  const freshProvidedKeys = new Set(placesItems.map((item) => item.key));
  const canonicalItems = buildCanonicalFallbackItems(canonicalBasicInfo, freshProvidedKeys);
  const canonicalConfirmedKeys = deriveCanonicalFallbackConfirmedKeys(canonicalItems);

  const items = [...placesItems, ...canonicalItems];
  return {
    items,
    placesConfirmedKeys,
    canonicalConfirmedKeys,
    deterministicKeys: items.map((item) => item.key),
  };
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
  // 突合キーは `normalizeUrlForMatch` を通す(Q6、Plan §8.2 B1)。
  // 従来は文字列完全一致のみだったため、末尾スラッシュ・scheme/host の case・fragment の
  // 差だけで url_context 成功を取りこぼしていた。`www.` 除去や origin-only match は
  // 行わない(trust判定にも使う正規化のため false negative を優先、§8.2.1)。
  const statusByUrl = new Map<string, "success" | "error">();
  for (const ucm of urlContextMetadataList) {
    if (!ucm) continue;
    for (const entry of ucm.urlMetadata) {
      if (!entry.retrievedUrl) continue;
      const key = normalizeUrlForMatch(entry.retrievedUrl);
      // 解釈できないURLは突合対象にしない(誤って別エントリへ紐付けない)。
      if (key === null) continue;
      const isSuccess = entry.status === "URL_RETRIEVAL_STATUS_SUCCESS";
      // 一度でも成功していれば成功を優先する。
      const existing = statusByUrl.get(key);
      if (existing === "success") continue;
      statusByUrl.set(key, isSuccess ? "success" : "error");
    }
  }

  return sourceRegistry.map((entry) => {
    const key = normalizeUrlForMatch(entry.grounding_redirect_url);
    if (key === null) return entry;
    const status = statusByUrl.get(key);
    if (!status || status === entry.url_context_status) return entry;
    return { ...entry, url_context_status: status };
  });
}

/**
 * `applySourceIdentityVerification` が Web ページの `observed_*` と突き合わせる
 * **比較 anchor**(PR #180 Sparse Store Source Identity Recovery)。
 *
 * ## なぜ `StoreIdentity` と別型にするのか
 *
 * PR #180 には accepted limitation として F1(Stage2 の prompt に載っている
 * target identity をモデルが `observed_*` へコピーすれば、自己申告で `target_match` へ
 * 昇格できてしまう)がある。本型には Stage0 の fresh Google Places 由来の値が
 * 入りうるため、これが Stage1 / Stage2 の prompt へ流入すると F1 を悪化させる。
 *
 * 本型は **`genre` を持たない**。`StoreIdentity` は `genre` を必須とするため、
 * `SourceVerificationTarget` を `stage1Step` / `stage2Step` / `buildStage1Prompt` /
 * `buildStage2Prompt` / `runStage2` へ渡すと**コンパイルエラーになる**。
 * これが「Gemini に見せない値である」ことのコンパイル時保証になる。
 *
 * ## 使ってよい場所
 *
 * Stage2 の Gemini 呼び出しが**完了した後**の `applySourceIdentityVerification` のみ。
 */
export interface SourceVerificationTarget {
  name: string;
  address: string;
  phone: string;
}

/**
 * `SourceVerificationTarget` を組み立てる(PR #180、**missing-only enrichment**)。
 *
 * ## 不変条件: 既存 `StoreIdentity` を fresh Places で上書きしない
 *
 * `stores.address` / `stores.phone` に有効値がある店舗では、**必ず従来値を使う**。
 * fresh Places 値を優先すると、
 *
 * - 既に identity を持つ全店舗の verification 挙動が変わり、回帰面積が一気に広がる
 * - Stage0 が誤った Place に strong match した場合、その誤りが
 *   「既存の正しい住所」を押しのけて Web source 全体の判定基準になる
 *
 * ため、本 PR の対象を **「identity 欠落店舗の false negative 救済」だけ**に限定する。
 *
 * ## 有効値の判定
 *
 * - `address`: `trim()` 後に非空か(`isAddressMatch` が空文字を弾く条件と同じ)
 * - `phone`: `normalizePhone()` 後に数字が残るか(`isTargetStoreMatch` の電話一致条件と同じ)。
 *   `stores.phone` は `text().notNull()` でフォーマット検証が無く「不明」「未掲載」「-」
 *   のような値が実在しうる。これらは正規化後 `""` になり電話一致に使われないため、
 *   **欠落として扱い fresh Places で補完してよい**
 *
 * ## name
 *
 * 常に `StoreIdentity.name` を使う。Places の `displayName` は登録名と異なりうるうえ、
 * `deriveSearchIdentityName` による営業管理タグ除去と `isNameMatch` の包含判定という
 * 既存セマンティクスを変えないため。
 *
 * 純関数。入力を変更しない。
 */
export function buildSourceVerificationTarget(
  store: StoreIdentity,
  verifiedIdentity: VerifiedPlacesIdentity | null,
): SourceVerificationTarget {
  return {
    name: store.name,
    address:
      store.address.trim() !== "" ? store.address : (verifiedIdentity?.address ?? ""),
    phone:
      normalizePhone(store.phone) !== "" ? store.phone : (verifiedIdentity?.phone ?? ""),
  };
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
  target: SourceVerificationTarget,
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

    const identityStatus = deriveIdentityStatusFromVerification(verification, target);
    const note =
      verification.note.length > MAX_IDENTITY_NOTE_LENGTH
        ? `${verification.note.slice(0, MAX_IDENTITY_NOTE_LENGTH)}…`
        : verification.note;

    return { ...entry, identity_status: identityStatus, identity_note: note };
  });
}

function deriveIdentityStatusFromVerification(
  verification: SourceVerification,
  target: SourceVerificationTarget,
): IdentityStatus {
  switch (verification.relation) {
    case "target_store":
      return isTargetStoreMatch(
        {
          name: verification.observed_name,
          address: verification.observed_address,
          phone: verification.observed_phone,
        },
        target,
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
  /**
   * canonical fallback item を合成した key(feat/ai-research-quality-ux-hardening)。
   * `deriveCanonicalFallbackConfirmedKeys` の結果だけを渡すこと。
   * trust boundary 側では `evidence_basis==="existing_canonical"` との AND で判定される。
   */
  canonicalVerifiedKeys?: ReadonlySet<string>;
}

/**
 * Stage2(AI対象項目)/ HEARING系項目を統合し、deterministic validation
 * (`applyDeterministicValidation`, PR1)を適用した最終結果を返す。
 */
export function finalizeResearchItems(params: FinalizeParams): ResearchItem[] {
  const {
    aiItems,
    nonAiItems,
    sourceRegistry,
    placesVerifiedKeys,
    searchFacts,
    canonicalVerifiedKeys,
  } = params;
  const merged = [...aiItems, ...nonAiItems];
  return merged.map((item) => {
    const validated = applyDeterministicValidation(item, {
      sourceRegistry,
      placesVerifiedKeys,
      searchFacts,
      canonicalVerifiedKeys,
      // conflict candidate へも phone の value/evidence 自己整合性を要求する(BLOCKER 2)。
      // trust boundary 本体(url_context / identity / competitor / 一次情報)は
      // `validateConflictCandidateTrust` が key 非依存で担い、ここは key 固有ルールのみ。
      conflictCandidateEvidenceGuard: isConflictCandidateEvidenceBacked,
    });
    // `phone` は役割ラベル付きで複数番号を保持できるようにした(Issue B)。
    // 番号を複数書けるとモデルが実在しない番号を生成するリスクが増えるため、
    // 「value の全番号が evidence にも現れる」ことを deterministic に要求する。
    // 既存の trust boundary(url_context / identity / source_ids)は
    // `applyDeterministicValidation` が担い、ここは番号そのものの裏付けだけを見る。
    return enforcePhoneNumbersBackedByEvidence(validated);
  });
}

export type { GroundingMetadataLike, SearchNote };
