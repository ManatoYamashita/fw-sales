/**
 * AI 店舗調査(53項目)の Structured Output 応答契約(AI 店舗調査再設計 Plan v3.2)。
 *
 * 本ファイルが `SourceRegistryEntry` / `ResearchItem` / `ResearchItemCandidate` /
 * `ReviewDecision` の Zod スキーマ・TypeScript 型の**単一情報源**である。
 * `types/research-run.ts` は本ファイルからの type-only re-export として機能する
 * (`lib/ai/schema.ts` → `types/ai-analysis.ts` と同じパターン)。
 *
 * PR1 のスコープでは、実際に Gemini API へ渡す動的 JSON Schema 生成関数
 * (`buildResearchResultJsonSchema` 相当、responseJsonSchema の source_ids.items.enum を
 * その run の Source Registry へ動的制限するもの)は**実装しない**(PR2 のスコープ)。
 * ここでは DB 保存・アプリ内検証に使う静的な Zod スキーマと、AI 応答を無条件に
 * 信用しないための deterministic validation 純関数群を提供する。
 *
 * 関連: Plan v3.2 §7, §8, §10, §11, §13
 */

import { z } from "zod";
import {
  RESEARCH_POLICIES,
  RESEARCH_POLICY_ITEMS,
  getResearchPolicy,
  type ResearchPolicy,
} from "@/lib/domain/research-policy";

/* ------------------------------------------------------------------ */
/*  Source Registry (Plan v3.2 §10, §11)                               */
/* ------------------------------------------------------------------ */

/**
 * Source Registry エントリの出典種別。Stage1 の `[SOURCE]` ブロックが
 * groundingChunks と URL 完全一致した場合にのみ enrichment として採用する
 * (Plan v3.2 §8「Source Registry構築ルール」)。
 */
export const SOURCE_TYPES = [
  "official_site",
  "official_sns",
  "google",
  "gourmet_site",
  "reservation_site",
  "local_official",
  "article",
  "competitor",
  "public_data",
  "other",
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

/** Stage 1.5 (redirect URL resolver) の結果種別。 */
export const RESOLVE_STATUSES = ["resolved", "failed", "skipped"] as const;
export type ResolveStatus = (typeof RESOLVE_STATUSES)[number];

/** URL Context によるsource本文取得の成否。UIの ✓/⚠/✕ 表示と validation の判断材料。 */
export const URL_CONTEXT_STATUSES = ["not_attempted", "success", "error"] as const;
export type UrlContextStatus = (typeof URL_CONTEXT_STATUSES)[number];

/**
 * Source Registry の由来(fix/ai-research-poc-like-retrieval で拡張、Spike 0.2/0.3の
 * 実証結果を反映)。
 *
 * - `google_grounding`: Stage1 の公式 `groundingMetadata.groundingChunks` 由来
 *   (後方互換のため維持。ただし実機検証(Spike 0.2)では2店舗・SDK 2バージョンとも
 *   一貫して空だったため、このprovenanceは事実上ほぼ観測されない見込み)。
 * - `gemini_search_candidate`: Stage1 のモデル自由記述 `[SOURCE]` ブロック由来の
 *   **候補**URL。「Geminiが候補として発見した」という意味のみで、信頼済みという
 *   意味は一切持たない。confirmedの根拠にできるのは、Stage2 URL Contextで実際に
 *   本文取得に成功した(`url_context_status==="success"`)場合のみ
 *   (`validateResearchItemStatus` が既存ロジックのまま担保する)。
 * - `known_store_data`: アプリが既に保持する店舗の公開URL(`stores.site_url`/
 *   `stores.instagram_url`)由来。Geminiより信頼度が高いseedだが、これも
 *   URLが存在するだけでconfirmedにはならない(同様にStage2 URL Context取得成功が必須)。
 *
 * Google Places 由来の値(`store_name`/`address`/`cuisine_genre`/`phone`/
 * `review_avg`/`review_count`)は本 Source Registry には**登録しない**
 * (Web Source専用のまま維持、PR1 fresh review 反映)。Places 検証済みの
 * confirmed 根拠は `validateResearchItemStatus` の `placesVerifiedKeys`
 * コンテキストで別経路として扱う(下記)。
 */
export const DISCOVERY_PROVENANCES = [
  "google_grounding",
  "gemini_search_candidate",
  "known_store_data",
] as const;
export type DiscoveryProvenance = (typeof DISCOVERY_PROVENANCES)[number];

/**
 * Source RegistryエントリのURLが実際に「対象店舗のページだった」かどうかの判定結果
 * (fix/ai-research-source-identity-integrity、実機smokeで発見したCONFIRMED BUGの修正)。
 *
 * `url_context_status==="success"` は「URL Contextがそのページの取得に成功した」ことのみを
 * 意味し、「取得したページが対象店舗について書かれている」ことは一切保証しない。
 * 実機smokeで、モデルが自己申告した正しそうなtitle(「東北メシ 炉端ジュン」)と、
 * 実際には完全な別店舗(「カフェ&民泊 三喜遊」)を指す誤ったURLが組み合わさり、
 * `url_context_status==="success"`のみで「対象店舗の根拠を確認済み」として扱われる
 * 事故が発生した。本フィールドはStage2の`source_verifications`(モデルがURL本文から
 * 実際に観測した店舗名・住所・電話番号)とStoreIdentityをコード側で突合した結果を保持し、
 * `url_context_status`とは独立した第二のtrust boundaryとして機能する。
 *
 * - `not_checked`: まだ照合されていない(Stage2が`source_verifications`でこのIDに
 *   言及しなかった場合、または本フィールド追加以前の既存run)。past runsとの
 *   後方互換のため`.optional()`(DB migration不要、欠落時は`not_checked`として扱う)。
 * - `target_match`: 観測された店舗名・住所/電話がStoreIdentityとコード側で一致した。
 * - `competitor_match`: モデルが競合店舗ページと申告し、対象店舗との一致は求めない
 *   (競合調査項目の根拠として使う。何と一致すべきかという「正解」が存在しないため、
 *   target_matchと同じ強度のコード側検証はできない)。
 * - `contextual`: 対象店舗固有のページではないが、商圏・市場等の文脈情報として有用
 *   (例: エリア特集記事)。
 * - `unrelated`: 対象店舗にも競合にも無関係と判定された(今回の事故のケースはこれに
 *   分類されるべきだった)。
 * - `uncertain`: モデルが`target_store`と自己申告したが、コード側の名前/住所/電話
 *   照合が成立しなかった、または観測情報が不足していた。自己申告を無条件に信用せず、
 *   false positiveよりfalse negativeを優先してこの値に倒す。
 */
export const IDENTITY_STATUSES = [
  "not_checked",
  "target_match",
  "competitor_match",
  "contextual",
  "unrelated",
  "uncertain",
] as const;
export type IdentityStatus = (typeof IDENTITY_STATUSES)[number];

export const SourceRegistryEntrySchema = z.object({
  /** run内で一意・連番の ID ("S01", "S02", ...)。モデルはこの ID のみを参照する。 */
  id: z.string(),
  /** groundingChunks[].title 由来(ホスト名相当)。モデル自己申告のためUI表示では
   *  無条件に信用しない(`deriveDisplaySourceName`参照)。 */
  title: z.string(),
  /** groundingChunks[].uri 由来。公式 grounding metadata が Source of Truth。 */
  grounding_redirect_url: z.string(),
  /** Stage 1.5 のベストエフォート解決結果。表示・監査用の付加情報。失敗時 null。 */
  resolved_url: z.string().nullable(),
  resolve_status: z.enum(RESOLVE_STATUSES),
  source_type: z.enum(SOURCE_TYPES),
  discovery_provenance: z.enum(DISCOVERY_PROVENANCES),
  /** Stage2 実行後に更新される。confirmed の deterministic validation の判断材料。 */
  url_context_status: z.enum(URL_CONTEXT_STATUSES),
  /** Stage2の`source_verifications`とStoreIdentityの突合結果。既存runとの後方互換のためoptional。 */
  identity_status: z.enum(IDENTITY_STATUSES).optional(),
  /** モデルが報告したverification note(観測できた内容の短い説明)。表示は補助情報に留める。 */
  identity_note: z.string().optional(),
});
export type SourceRegistryEntry = z.infer<typeof SourceRegistryEntrySchema>;

/**
 * Stage2 Structured Outputの`source_verifications[].relation`(モデル自己申告)。
 * `target_store`であっても、コード側の名前/住所/電話照合(`isTargetStoreMatch`、
 * `lib/ai/research/identity-match.ts`)が成立しない限り`identity_status`は
 * `target_match`にならない(`uncertain`へ倒す)。
 */
export const SOURCE_VERIFICATION_RELATIONS = [
  "target_store",
  "competitor",
  "contextual",
  "unrelated",
  "uncertain",
] as const;
export type SourceVerificationRelation = (typeof SOURCE_VERIFICATION_RELATIONS)[number];

/**
 * Stage2 Structured Outputへ追加したper-source identity verification
 * (fix/ai-research-source-identity-integrity)。`observed_*`はプロンプトの店舗情報を
 * コピーさせず、そのURL本文で実際に確認できた値のみを書かせる(確認できなければnull)。
 * 既存Gemini call数を増やさないため、Stage2の同一Structured Output内へ追加する
 * (追加のGemini呼出は発生しない)。
 */
export const SourceVerificationSchema = z.object({
  source_id: z.string(),
  relation: z.enum(SOURCE_VERIFICATION_RELATIONS),
  observed_title: z.string().nullable(),
  observed_name: z.string().nullable(),
  observed_address: z.string().nullable(),
  observed_phone: z.string().nullable(),
  note: z.string(),
});
export type SourceVerification = z.infer<typeof SourceVerificationSchema>;

/* ------------------------------------------------------------------ */
/*  ResearchItem (Plan v3.2 §7, §10)                                   */
/* ------------------------------------------------------------------ */

/** research_policy の Zod enum(`lib/domain/research-policy.ts` の値をそのまま使う)。 */
export const ResearchPolicySchema = z.enum(RESEARCH_POLICIES);

export const RESEARCH_STATUSES = [
  "confirmed",
  "inferred",
  "conflict",
  "not_found",
  "hearing_required",
  "external_data_required",
] as const;
export type ResearchStatus = (typeof RESEARCH_STATUSES)[number];

export const ResearchItemCandidateSchema = z.object({
  /** 配列indexに依存しない安定ID("候補A"等の表示ラベルとは別)。item内で一意。 */
  candidate_id: z.string(),
  label: z.string(),
  value: z.string(),
  evidence: z.string(),
  /** Source Registry の id 参照のみ。URLを直接持たない(Plan v3.2 §4)。 */
  source_ids: z.array(z.string()),
});
export type ResearchItemCandidate = z.infer<typeof ResearchItemCandidateSchema>;

/**
 * confirmedを維持する根拠の由来(feat/ai-research-quality-refinement、内部トラッキング用)。
 * UIへの表示は別PRのスコープ。confirmed以外のstatusでは意味を持たないため付与しない。
 *
 * - `places`: `placesVerifiedKeys`(Google Places検証済み)経由でconfirmed。
 * - `url_context`: `url_context_status==="success"`のsourceのみでconfirmed。
 * - `search_note`: Tier B(`SearchFact`一致 + source trust matrix許可)のみでconfirmed。
 * - `mixed`: 上記のうち複数の経路が同時に該当する場合。
 */
export const EVIDENCE_BASES = ["places", "url_context", "search_note", "mixed"] as const;
export type EvidenceBasis = (typeof EVIDENCE_BASES)[number];

export const ResearchItemSchema = z.object({
  /** `BASIC_INFO_ITEMS` の key と一致。 */
  key: z.string(),
  /**
   * AIが返す research_policy は**信用しない**。`lib/domain/research-policy.ts`
   * (Source of Truth)を正として `enforceResearchPolicy()` が強制的に上書きする
   * (Plan v3.2 PR1 fresh review B)。この Zod schema レベルでは形式検証のみ行う。
   */
  research_policy: ResearchPolicySchema,
  status: z.enum(RESEARCH_STATUSES),
  /** status="conflict" 時はここではなく candidates 側に候補値を持つ。 */
  value: z.string().nullable(),
  evidence: z.string(),
  /** Source Registry の id 配列のみ。URLを直接持たない(Plan v3.2 §4)。 */
  source_ids: z.array(z.string()),
  confidence: z.number().min(0).max(100).nullable().optional(),
  warning: z.string().nullable().optional(),
  /** status="conflict" 時のみ使用。 */
  candidates: z.array(ResearchItemCandidateSchema).nullable().optional(),
  /** confirmed維持の根拠由来(feat/ai-research-quality-refinement、内部トラッキング用、UI非表示)。 */
  evidence_basis: z.enum(EVIDENCE_BASES).nullable().optional(),
});
export type ResearchItem = z.infer<typeof ResearchItemSchema>;

export const ResearchItemsSchema = z.array(ResearchItemSchema);

/* ------------------------------------------------------------------ */
/*  ReviewDecision (Plan v3.2 §12, §15)                                 */
/* ------------------------------------------------------------------ */

/**
 * `adopted | rejected | skipped` の3状態(Plan v3.2 §12)。`skipped` は
 * 「内容は確認したが今回は採用/却下を判断しない」という明示的な判断であり、
 * 単なる「未対応」とは区別する(レビュー完了条件の判定に使う、Plan §15)。
 */
export const REVIEW_DECISION_TYPES = ["adopted", "rejected", "skipped"] as const;
export type ReviewDecisionType = (typeof REVIEW_DECISION_TYPES)[number];

/**
 * `decision` によって許可されるフィールドを discriminated union で厳格化する
 * (Plan v3.2 PR1 fresh review E)。`.strict()` により余剰フィールドを拒否するため、
 * 例えば `decision: "rejected"` に `selected_candidate_id` を付けた不正な組み合わせは
 * Zod パース時点で弾かれる。過剰な意味論チェック(例: `selected_candidate_id` が実在の
 * candidate かどうか)はここでは行わず、`validateReviewDecisionAgainstItem` に委ねる。
 */
export const ReviewDecisionSchema = z.discriminatedUnion("decision", [
  z
    .object({
      decision: z.literal("adopted"),
      /** conflict項目で候補を選んだ場合のみ。ResearchItemCandidate.candidate_id を参照。 */
      selected_candidate_id: z.string().optional(),
      /** 「編集して採用」時の最終値のみ(未編集なら省略)。 */
      edited_value: z.string().optional(),
      decided_at: z.string(),
    })
    .strict(),
  z
    .object({
      decision: z.literal("rejected"),
      decided_at: z.string(),
    })
    .strict(),
  z
    .object({
      decision: z.literal("skipped"),
      decided_at: z.string(),
    })
    .strict(),
]);
export type ReviewDecision = z.infer<typeof ReviewDecisionSchema>;

export const ReviewDecisionsSchema = z.record(z.string(), ReviewDecisionSchema);
export type ReviewDecisions = z.infer<typeof ReviewDecisionsSchema>;

/**
 * `ReviewDecision` を実際の `ResearchItem`/`candidates` に対して整合検証する。
 *
 * - `selected_candidate_id` は対象itemの`candidates[].candidate_id`のいずれかと
 *   一致すること(conflict項目以外で指定されている場合も不正)。
 * - Zod discriminated union は「rejected/skippedにselected_candidate_idが付いていない」
 *   ことは保証するが、「adoptedのselected_candidate_idが実在するcandidateを指すか」は
 *   itemを見ないと判定できないため、ここで検証する。
 */
export function isValidReviewDecisionForItem(
  decision: ReviewDecision,
  item: ResearchItem,
): boolean {
  if (decision.decision !== "adopted") return true;
  if (decision.selected_candidate_id === undefined) return true;
  if (item.status !== "conflict") return false;
  const candidateIds = new Set((item.candidates ?? []).map((c) => c.candidate_id));
  return candidateIds.has(decision.selected_candidate_id);
}

/* ------------------------------------------------------------------ */
/*  research_policy trust boundary (Plan v3.2 PR1 fresh review B)       */
/* ------------------------------------------------------------------ */

/**
 * AIが返した `research_policy` を無条件に信用しない。`lib/domain/research-policy.ts`
 * (Source of Truth)を正とし、`item.key` から導出した正しい値へ強制的に上書きする。
 *
 * `item.key` が `RESEARCH_POLICY_BY_KEY` に存在しない(AIが未知のkeyを捏造した)場合、
 * その項目自体を信用できないため `status: "not_found"` に落として無効化する
 * (research_policy 自体は判定不能なため、元の値をそのまま保持しつつ warning を付す)。
 *
 * 純関数。入力を変更せず、新しい `ResearchItem` を返す。
 */
export function enforceResearchPolicy(item: ResearchItem): ResearchItem {
  const truePolicy = getResearchPolicy(item.key);

  if (truePolicy === undefined) {
    return {
      ...item,
      status: "not_found",
      value: null,
      source_ids: [],
      candidates: undefined,
      warning: appendWarning(
        item.warning,
        `未知のkey "${item.key}" のためこの項目は無効化されました。`,
      ),
    };
  }

  if (item.research_policy === truePolicy) return item;

  return {
    ...item,
    research_policy: truePolicy,
    warning: appendWarning(
      item.warning,
      `AIが返したresearch_policy(${item.research_policy})を正しい値(${truePolicy})へ補正しました。`,
    ),
  };
}

/* ------------------------------------------------------------------ */
/*  source_ids 防御 (Plan v3.2 PR1 fresh review C)                      */
/* ------------------------------------------------------------------ */

/**
 * `item.source_ids` および `candidates[].source_ids` から、その run の
 * Source Registry に実在しない ID(モデルが捏造した "S99" 等)を除去する。
 *
 * PR2 の動的 JSON Schema (`source_ids.items.enum`) による防御だけに頼らず、
 * deterministic validation 側でも独立に防御する(Plan v3.2 PR1 fresh review C の指示)。
 *
 * 純関数。入力を変更せず、新しい `ResearchItem` を返す。
 */
export function sanitizeSourceIds(
  item: ResearchItem,
  sourceRegistry: readonly SourceRegistryEntry[],
): ResearchItem {
  const validIds = new Set(sourceRegistry.map((entry) => entry.id));

  const filteredSourceIds = item.source_ids.filter((id) => validIds.has(id));
  const droppedTopLevel = item.source_ids.length !== filteredSourceIds.length;

  let droppedCandidate = false;
  const filteredCandidates = item.candidates?.map((candidate) => {
    const filtered = candidate.source_ids.filter((id) => validIds.has(id));
    if (filtered.length !== candidate.source_ids.length) droppedCandidate = true;
    return { ...candidate, source_ids: filtered };
  });

  if (!droppedTopLevel && !droppedCandidate) return item;

  return {
    ...item,
    source_ids: filteredSourceIds,
    candidates: filteredCandidates,
    warning: appendWarning(
      item.warning,
      "Source Registryに存在しない出典IDが参照されていたため除去しました。",
    ),
  };
}

/* ------------------------------------------------------------------ */
/*  conflict 整合性 (Plan v3.2 PR1 fresh review D)                       */
/* ------------------------------------------------------------------ */

/**
 * conflict の形状整合性を検証・是正する:
 * - `status !== "conflict"` の項目は `candidates` を持たない(AIが誤って付与しても除去)。
 * - `status === "conflict"` の項目は `candidates` が(重複除去後)**2件以上**、かつ
 *   異なる `value` が2種類以上存在すること(feat/ai-research-pre-smoke-hardening、
 *   MAJOR4)。0件・1件、または全candidateが同一valueの場合は「候補を提示できない
 *   /実質的に競合していないのに競合と主張する」矛盾した状態のため `not_found` へ
 *   降格する。
 * - `candidate_id` の重複は先勝ちで排除する(`selected_candidate_id` の一意な
 *   参照解決を保証するため)。
 *
 * 純関数。入力を変更せず、新しい `ResearchItem` を返す。
 */
export function validateConflictShape(item: ResearchItem): ResearchItem {
  if (item.status !== "conflict") {
    if (item.candidates === undefined || item.candidates === null) return item;
    return { ...item, candidates: undefined };
  }

  const candidates = item.candidates ?? [];

  const seen = new Set<string>();
  const deduped: ResearchItemCandidate[] = [];
  let hadDuplicate = false;
  for (const candidate of candidates) {
    if (seen.has(candidate.candidate_id)) {
      hadDuplicate = true;
      continue;
    }
    seen.add(candidate.candidate_id);
    deduped.push(candidate);
  }

  const distinctValues = new Set(deduped.map((c) => c.value.trim()));
  if (deduped.length < 2 || distinctValues.size < 2) {
    return {
      ...item,
      status: "not_found",
      candidates: undefined,
      warning: appendWarning(
        item.warning,
        "AIがconflictと判定しましたが、実質的に競合する候補(2件以上・異なる値)が揃わなかったため無効化しました。",
      ),
    };
  }

  if (!hadDuplicate) return item;
  return {
    ...item,
    candidates: deduped,
    warning: appendWarning(item.warning, "重複したcandidate_idを除去しました。"),
  };
}

/* ------------------------------------------------------------------ */
/*  confirmed の deterministic validation (Plan v3.2 §10 末尾, §13)      */
/* ------------------------------------------------------------------ */

/**
 * Stage1のGoogle Search実行時に得られた構造化事実(feat/ai-research-quality-refinement)。
 * `[SEARCH_NOTE]`の`kind: store_fact`かつ`key`/`value`が明示されたものを、Source Registryの
 * `id`へ解決(sourceUrl→id)した後の形。生URLは持たない(既存のsource_ids参照方式と統一)。
 */
export interface SearchFact {
  /** Source Registry の id (例: "S03")。 */
  sourceId: string;
  /** `BASIC_INFO_ITEMS`/`RESEARCH_POLICY_ITEMS` の key と一致。 */
  key: string;
  /** 確認できた具体的な値(自由文字列)。 */
  value: string;
}

/**
 * Tier B「reliable secondary evidence」の対象key単位の許可source_type
 * (feat/ai-research-quality-refinement、旧`RELIABLE_SECONDARY_FACT_KEYS`固定リストを置換)。
 *
 * `url_context_status==="success"`が無くても、`SearchFact`(key一致・具体的value有り)と
 * 組み合わせてconfirmedを許可するsource_typeをkeyごとに定義する。`review_avg`/`review_count`は
 * 意図的に登録しない(Google Places由来のdeterministic itemとしてGemini対象外になるため)。
 *
 * `average_spend_day_night`は意図的に登録しない(feat/ai-research-pre-smoke-hardening、
 * 追加修正C)。この項目は「昼/夜」等の複合的なANALYSIS値であり、単一のSearchFactで
 * AIの複合valueを丸ごと置き換えると情報が失われる(例: SearchFactは昼の価格帯のみを
 * 確認できたが、AIのvalueは昼・夜両方を含む)。安全に部分置換する仕組みが無い以上、
 * false positiveよりfalse negativeを優先し、この項目はTier B(SearchFact-only)経路での
 * confirmedを許可しない(url_context成功による通常経路のみでconfirmed可能)。
 */
export const SOURCE_TRUST_MATRIX: Readonly<Record<string, readonly SourceType[]>> = {
  opening_date: ["official_site", "local_official", "article", "gourmet_site", "reservation_site"],
  business_hours_holidays: ["gourmet_site", "reservation_site", "official_site"],
  seat_count: ["official_site", "gourmet_site", "reservation_site"],
  cuisine_genre: ["gourmet_site", "reservation_site"],
  alacarte_course: ["gourmet_site", "reservation_site"],
  phone: ["gourmet_site", "reservation_site"],
  nearest_station: ["official_site", "gourmet_site", "reservation_site", "local_official", "article"],
  floor_level: ["gourmet_site", "reservation_site"],
  reservation_tool: ["gourmet_site", "reservation_site"],
  media_coverage: ["article", "local_official", "gourmet_site", "reservation_site", "official_site"],
};

/**
 * 既知の主要グルメ/予約ポータルのhostname→source_type分類(feat/ai-research-pre-smoke-hardening、
 * 追加修正B・MAJOR6)。
 *
 * `gemini_search_candidate`/`google_grounding`のsource_typeはStage1モデルの自己申告
 * (`[SOURCE]`ブロックの`type:`フィールド)であり、`google_grounding`由来であっても
 * `buildSourceRegistry`がenrichment時に同じ自己申告typeを採用するため、
 * discovery_provenanceだけでは信頼できない。Tier Bで`source_type`を信用してよいのは、
 * (1) `known_store_data`(アプリ自身がtypeを決定、Stage1モデルを経由しない)、
 * (2) 以下のhostname classifierで決定的に判定できる既知ポータルのみに限定する。
 * 巨大なallowlistは作らず、実際にfw-salesの調査で頻出する主要媒体のみを列挙する。
 */
const KNOWN_HOSTNAME_SOURCE_TYPES: Readonly<Record<string, SourceType>> = {
  "tabelog.com": "gourmet_site",
  "www.tabelog.com": "gourmet_site",
  "hotpepper.jp": "gourmet_site",
  "www.hotpepper.jp": "gourmet_site",
  "gnavi.co.jp": "gourmet_site",
  "www.gnavi.co.jp": "gourmet_site",
  "r.gnavi.co.jp": "gourmet_site",
  "retty.me": "gourmet_site",
  "www.retty.me": "gourmet_site",
  "jalan.net": "reservation_site",
  "www.jalan.net": "reservation_site",
};

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * 既知hostname→UI表示名(fix/ai-research-source-identity-integrity、FIX9)。
 * `KNOWN_HOSTNAME_SOURCE_TYPES`とは意図的に別のmapとして持つ(既存の信頼判定ロジックへの
 * 影響を避けるため)。実機smokeで、モデル自己申告の`entry.title`(「東北メシ 炉端ジュン」)
 * が実際には全く別店舗のURLに付けられていた事故を踏まえ、UI上の媒体名は可能な限り
 * hostnameからdeterministicに導出し、モデル自己申告titleを「確認済みソース名」として
 * 無条件表示しない。
 */
const KNOWN_HOSTNAME_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  "tabelog.com": "食べログ",
  "www.tabelog.com": "食べログ",
  "hotpepper.jp": "ホットペッパーグルメ",
  "www.hotpepper.jp": "ホットペッパーグルメ",
  "gnavi.co.jp": "楽天ぐるなび",
  "www.gnavi.co.jp": "楽天ぐるなび",
  "r.gnavi.co.jp": "楽天ぐるなび",
  "retty.me": "Retty",
  "www.retty.me": "Retty",
  "jalan.net": "じゃらんnet",
  "www.jalan.net": "じゃらんnet",
};

/**
 * Google Search grounding のredirect URLが使うtransport host(実機Preview検証、
 * 2026-08-07で発見)。`https://vertexaisearch.cloud.google.com/grounding-api-redirect/...`
 * は実際に掲載されている媒体のURLではなく、Googleがgrounding結果を中継するための
 * 転送先に過ぎない。`lib/ai/research/source-url-resolver.ts`の`ALLOWED_START_HOSTS`と
 * 同じ値だが、そちらは`node:net`に依存するserver-onlyモジュール(SSRF対策用)であり、
 * 本ファイルはclient component(`research-source-badge.tsx`)からもimportされるため
 * 直接参照せずローカルに再定義する。
 *
 * `fix/ai-research-poc-like-retrieval`でStage1.5(grounding redirect URLの解決)が
 * クリティカルパスから撤去されて以降、`gemini_search_candidate`由来のエントリは
 * `resolved_url`が恒常的にnullのままとなり、`deriveDisplaySourceName`が
 * `grounding_redirect_url`のhostnameであるこの値をそのまま媒体名として返してしまう
 * 実バグを引き起こしていた(`media_coverage`/`own_net_exposure`/`exposure_gap`の
 * `ResearchItem.value`に"vertexaisearch.cloud.google.com"が混入)。
 */
const TRANSPORT_ONLY_HOSTNAMES: ReadonlySet<string> = new Set([
  "vertexaisearch.cloud.google.com",
]);

/**
 * 実媒体名を安全に特定できない場合の汎用プレースホルダ。特定の媒体名を推測・捏造しない
 * (`vertexaisearch.cloud.google.com`のようなtransport hostをそのまま出さない代わりに
 * "Google"等の別の誤った固有名詞へ置き換えることもしない)。
 */
const UNKNOWN_SOURCE_DISPLAY_NAME = "情報源(詳細不明)";

/**
 * UI表示用のsource名を導出する。`known_store_data`はアプリ自身が付けた固定文言
 * (`buildKnownStoreDataEntries`、モデル生成ではない)のため`entry.title`をそのまま使う。
 * それ以外(`gemini_search_candidate`/`google_grounding`)は、既知hostnameならその
 * 表示名、未知の実hostnameならhostname文字列そのものを使う。
 *
 * hostnameがtransport-only(`vertexaisearch.cloud.google.com`)またはURLとして
 * パースできない場合、実媒体名をhostnameから機械的に特定できない。この場合に限り、
 * Stage2の`source_verifications`とStoreIdentityの突合で確認済み(`identity_status`が
 * `target_match`/`competitor_match`/`contextual`のいずれか)であることを条件に
 * モデル自己申告の`entry.title`へfallbackする。これはFIX9が回避しようとした事故
 * (別店舗URLに自店名titleが付いていた)を、hostname非表示という粗い手段ではなく
 * `identity_status`という後発の、より正確なtrust boundaryで直接防ぐ形になる
 * (false positiveよりfalse negativeを優先する既存方針と整合)。
 * 未確認(`uncertain`/`unrelated`/`not_checked`/未設定)の場合は、特定の媒体名を
 * 推測せず`UNKNOWN_SOURCE_DISPLAY_NAME`を返す。
 */
export function deriveDisplaySourceName(entry: SourceRegistryEntry): string {
  if (entry.discovery_provenance === "known_store_data") return entry.title;

  const host = hostnameOf(entry.resolved_url ?? entry.grounding_redirect_url);
  if (host !== null && !TRANSPORT_ONLY_HOSTNAMES.has(host)) {
    return KNOWN_HOSTNAME_DISPLAY_NAMES[host] ?? host;
  }

  const isVerified =
    entry.identity_status === "target_match" ||
    entry.identity_status === "competitor_match" ||
    entry.identity_status === "contextual";
  if (isVerified && entry.title.trim() !== "") return entry.title;

  return UNKNOWN_SOURCE_DISPLAY_NAME;
}

/**
 * UI上でsource URLをクリック可能なリンクにしてよいか判定する
 * (fix/ai-research-source-identity-integrity、FIX8)。
 *
 * 識別確認(`identity_status`)が済んでいない`gemini_search_candidate`/
 * `google_grounding`のURLは、実機smokeで確認された通り全く無関係な別店舗のページを
 * 指している可能性がある。ユーザーが誤って無関係な外部ページへ誘導されないよう、
 * 識別確認済み(target_match/competitor_match/contextual)または`known_store_data`
 * (アプリ自身が保持するURL)の場合のみクリック可能にする。
 */
export function isSourceLinkClickable(entry: SourceRegistryEntry): boolean {
  if (entry.discovery_provenance === "known_store_data") return true;
  const status = entry.identity_status;
  return status === "target_match" || status === "competitor_match" || status === "contextual";
}

/**
 * Tier B判定に使ってよい「信頼済みsource_type」を導出する。自己申告の
 * `entry.source_type`をそのまま信用せず、以下のいずれかの場合のみ返す:
 * (1) `discovery_provenance === "known_store_data"`(app側が決定、信頼済み)。
 * (2) `grounding_redirect_url`のhostnameが`KNOWN_HOSTNAME_SOURCE_TYPES`に一致する
 *     (コード側で決定的に判定できる既知ポータル)。
 * いずれにも該当しない場合(`gemini_search_candidate`/`google_grounding`でモデルの
 * 自己申告typeにのみ依存する場合)は`undefined`を返し、Tier B対象外とする
 * (feat/ai-research-pre-smoke-hardening、MAJOR6・追加修正B)。
 *
 * URL Context成功経路(path 2、`hasVerifiedSource`)はこの制約の対象外(本文取得
 * 成功という別の裏付けがあるため、source_typeの自己申告可否を問わない)。
 */
export function deriveTrustedSourceType(entry: SourceRegistryEntry): SourceType | undefined {
  if (entry.discovery_provenance === "known_store_data") return entry.source_type;
  const host = hostnameOf(entry.grounding_redirect_url);
  if (host !== null && KNOWN_HOSTNAME_SOURCE_TYPES[host] !== undefined) {
    return KNOWN_HOSTNAME_SOURCE_TYPES[host];
  }
  return undefined;
}

/**
 * FACT_OR_HEARING項目のうち、AI検索では「本人発信の一次情報」が無ければconfirmedを
 * 認めないべき4項目(feat/ai-research-pre-smoke-hardening、MAJOR5・追加修正A)。
 * 第三者グルメサイト・記事の本文取得成功だけでは「本人発信」を保証できないため、
 * 自動的にconfirmedを維持してよいsource_typeを`official_site`/`official_sns`のみに
 * 限定する。`article`(インタビュー記事等)は将来別途明示的なprovenance設計が
 * できるまでは含めない(false positiveよりfalse negativeを優先)。
 */
const PRIMARY_SOURCE_REQUIRED_KEYS: ReadonlySet<string> = new Set([
  "owner_profile",
  "owner_career",
  "owner_philosophy",
  "concept",
]);
const PRIMARY_SOURCE_TYPES: ReadonlySet<SourceType> = new Set(["official_site", "official_sns"]);

/**
 * 競合店舗そのものを調査対象とする項目(fix/ai-research-source-identity-integrity)。
 * これらの項目は対象店舗ではなく競合店舗のページが根拠になってよいため、
 * `identity_status==="competitor_match"`を要求する(target_matchは要求しない)。
 */
const COMPETITOR_ITEM_KEYS: ReadonlySet<string> = new Set([
  "competitor_stores",
  "competitor_benchmark",
  "competitor_paid_ads",
]);

/**
 * 対象店舗固有のページではなく、商圏・市場等の文脈情報を根拠として許容してよい項目
 * (fix/ai-research-source-identity-integrity)。`target_match`に加え`contextual`
 * (エリア特集記事等)も根拠として認める。巨大なmatrixを避けるため、明確に
 * 「対象店舗個別のページである必要が薄い」項目のみへ限定する。
 */
const CONTEXTUAL_ITEM_KEYS: ReadonlySet<string> = new Set(["trade_area", "market_demand"]);

/**
 * `item.key`のカテゴリに応じて、confirmedの根拠として要求する`identity_status`の
 * 集合を返す(fix/ai-research-source-identity-integrity、実機smokeで発見したCONFIRMED
 * BUGの修正)。デフォルトは「対象店舗固有情報」として`target_match`のみを要求する
 * (今回事故になったHotPepperの誤URLはこの既定ルールで`unrelated`/`uncertain`となり
 * 除外される想定)。
 */
function getRequiredIdentityStatuses(key: string): ReadonlySet<IdentityStatus> {
  if (COMPETITOR_ITEM_KEYS.has(key)) return new Set(["competitor_match"]);
  if (CONTEXTUAL_ITEM_KEYS.has(key)) return new Set(["target_match", "contextual"]);
  return new Set(["target_match"]);
}

/**
 * Source Registryエントリが`item.key`のconfirmed根拠として使ってよい identity か判定する。
 * `not_checked`(未検証・既存runとの後方互換)・`unrelated`・`uncertain`は
 * どのカテゴリでも根拠として認めない(false positiveよりfalse negativeを優先)。
 */
function isIdentityAcceptableForItem(entry: SourceRegistryEntry, itemKey: string): boolean {
  const identityStatus = entry.identity_status ?? "not_checked";
  return getRequiredIdentityStatuses(itemKey).has(identityStatus);
}

/**
 * Tier B(SearchFact)による今回の実機smoke事故を踏まえた方針(fix/ai-research-source-identity-integrity):
 * 第三者(known_store_data以外)のSearchFact-onlyエビデンスは、target項目のconfirmedの
 * 根拠に**使わない**。`hotpepper.jp`のような信頼済みhostnameであっても、実際に指している
 * ページが対象店舗かどうかはURL Context本文取得+`source_verifications`による識別確認
 * (`identity_status`)を経なければ判定できないため(今回のHotPepper誤URL事故の直接原因)。
 * `known_store_data`(`stores.site_url`/`instagram_url`)はアプリ自身が対象店舗のURLとして
 * 保持するデータであり、Geminiの発見・自己申告を経由しないため、この制約の対象外とする。
 */
function isTierBEligible(entry: SourceRegistryEntry): boolean {
  return entry.discovery_provenance === "known_store_data";
}

/**
 * Tier B(SearchFact)判定で「同一keyに複数の異なるSearchFact値」を対立する事実では
 * なく複数媒体の並立として扱ってよいkey(fix/ai-research-final-audit-hardening、
 * 監査で発見したCONFIRMED BUGの修正)。
 *
 * 通常のTier B対象key(例: seat_count)は、異なるsourceが異なるvalueを報告した場合、
 * どちらが正しいか機械的に判断できないためconfirmedにしない(false positiveを防ぐ、
 * BLOCKER3)。しかし`media_coverage`は「どの媒体に掲載されているか」という列挙型の
 * 項目であり、`pipeline.ts:upgradeMediaCoverageFromRegistry`が複数の検証済み媒体を
 * 集約してvalue/source_idsを構築する。各SearchFactは異なる媒体それぞれについての
 * 独立した証拠であって、同一の事実に対する対立する主張ではないため、この項目に
 * 限り distinct-value 制約を適用しない(`upgradeMediaCoverageFromRegistry`が既に
 * `deriveTrustedSourceType`で個々のsourceを信頼境界チェック済みであることが前提)。
 *
 * 監修前の実バグ: url_context成功が1件も無く、SearchFactのみで検証された媒体が
 * 2件以上(かつそれぞれ異なる自由文字列valueを持つ、通常のGemini出力では必発)の
 * 場合、本チェックが無いと`hasSearchFactMatch`が常にfalseになり、
 * `upgradeMediaCoverageFromRegistry`が正しく集約したconfirmedな複数媒体情報が
 * 丸ごとnot_foundへ格下げされ消えていた。
 */
const MULTI_SOURCE_AGGREGATION_KEYS: ReadonlySet<string> = new Set(["media_coverage"]);

/** `validateResearchItemStatus` の判定コンテキスト。 */
export interface ResearchValidationContext {
  /** Stage1 + Stage1.5 で構築した Source Registry(Web Source専用)。 */
  sourceRegistry: readonly SourceRegistryEntry[];
  /**
   * その run で Google Places により最新確認された `ResearchItem.key` の集合
   * (Plan v3.2 PR1 fresh review A)。Places は `store_name` / `address` /
   * `cuisine_genre` / `phone` / `review_avg` / `review_count` の最大6項目のみを
   * 埋めるため、実際に non-empty になるのはこれらの key に限られる想定だが、
   * 本関数自体はどの key かをハードコードしない(呼び出し側が Stage0 の実行結果から
   * 動的に構築する)。
   *
   * 設計判断: Source Registry (Web Source専用) に Google Places 由来のエントリを
   * 混ぜない。confirmed の根拠を「(1) 最新Placesで検証済み」または
   * 「(2) URL Context取得成功のSource Registryエントリ」のいずれかとして
   * 独立した2経路で扱う(Plan v3.2 PR1 fresh review A の第一候補方式)。
   */
  placesVerifiedKeys?: ReadonlySet<string>;
  /**
   * Stage1のSearch Notes由来の構造化事実(feat/ai-research-quality-refinement)。
   * Tier B(下記)の判定にのみ使う。単なるsource_type一致だけではconfirmedを許可しない
   * (「URLが存在するだけではそのkeyの根拠にしない」という設計思想)。
   */
  searchFacts?: readonly SearchFact[];
}

/**
 * AIが返した `status` をそのまま信用しない。`status==="confirmed"` の項目は、
 * 以下のいずれかを満たす場合のみ confirmed を維持する:
 *
 * 1. `context.placesVerifiedKeys` に `item.key` が含まれる(最新Google Placesで
 *    検証済み、Plan v3.2 PR1 fresh review A)。
 * 2. `source_ids` が `url_context_status==="success"` の Source Registry エントリを
 *    少なくとも1件含む(Web調査で本文取得に成功した根拠がある)。
 * 3. Tier B「reliable secondary evidence」(feat/ai-research-quality-refinement):
 *    `item.key`が`SOURCE_TRUST_MATRIX`に定義されており、`context.searchFacts`に
 *    (a) `key`が一致し (b) `sourceId`が`item.source_ids`に含まれ (c) その
 *    Source Registryエントリの`source_type`が許可済み、を満たす`SearchFact`が
 *    存在する(本文取得成功は必須としない)。単なる「対象source_typeのURLが
 *    source_idsに存在するだけ」では confirmed を許可しない。`review_avg`/
 *    `review_count`は`SOURCE_TRUST_MATRIX`に登録しないため対象外。
 *
 * いずれも満たさない場合は research_policy ごとに定めた降格先へ機械的に降格する:
 *
 * - FACT: confirmed には inferred という逃げ道が無い(FACTのstatus空間に
 *   inferred は含まれない)ため not_found へ。
 * - ANALYSIS: 弱い根拠付きの推定として扱える(ANALYSISの元々の設計)ため inferred へ。
 * - FACT_OR_HEARING: AIが推測すべきでない項目のため hearing_required へ。
 * - HEARING_ONLY / EXTERNAL_DATA_REQUIRED: これらは AI 呼び出し自体を経ないため
 *   本来 confirmed になることはない想定だが、応答に混入した場合の安全側
 *   フォールバックとして各policyの既定status(hearing_required /
 *   external_data_required)に倒す。
 *
 * no-infoステータス(not_found/hearing_required/external_data_required)への降格時は
 * `value`/`confidence`/`candidates`を`null`化する(feat/ai-research-quality-refinement、
 * 「確認できず」なのに具体的な値が残る矛盾を防ぐ)。ANALYSIS→inferredの降格のみ、
 * 弱い根拠付きの推定値として`value`/`confidence`を維持する。
 *
 * 「Google Searchだけで見つかりURL Contextで本文取得できなかったsource」は
 * 検証対象から除外される(= confirmedの根拠として使わない、Plan v3.2 §5)。
 *
 * 呼び出し前提: `enforceResearchPolicy` / `enforceStatusForPolicy` / `sanitizeSourceIds` /
 * `validateConflictShape` を先に適用済みであること(`applyDeterministicValidation` は
 * この順序を保証する)。
 *
 * 純関数。入力を変更せず、新しい `ResearchItem` を返す。
 */
export function validateResearchItemStatus(
  item: ResearchItem,
  context: ResearchValidationContext,
): ResearchItem {
  if (item.status !== "confirmed") return item;

  // HEARING_ONLY / EXTERNAL_DATA_REQUIRED はそもそも AI 呼び出しを経ないため、
  // source_ids がたまたま検証済みsourceを参照していても正当な根拠にはなりえない。
  // Places検証(placesVerifiedKeys)より前段で無条件に降格する。
  if (
    item.research_policy === "HEARING_ONLY" ||
    item.research_policy === "EXTERNAL_DATA_REQUIRED"
  ) {
    const downgradedStatus = getConfirmedDowngradeStatus(item.research_policy);
    return {
      ...nullifyForNoInfoStatus(item, downgradedStatus),
      status: downgradedStatus,
      warning: appendWarning(
        item.warning,
        `research_policy=${item.research_policy}の項目はAIがconfirmedと判定できないため自動的に格下げしました。`,
      ),
    };
  }

  const isPlacesVerified = context.placesVerifiedKeys?.has(item.key) ?? false;

  // path 2: URL Context本文取得成功のsourceのみ根拠にできる。ただし以下は除外する
  // (feat/ai-research-pre-smoke-hardening、fix/ai-research-source-identity-integrity):
  // - MAJOR8: competitor(競合店舗)由来のsourceは自店項目のconfirmed根拠にしない
  //   (「明らかに不適合」な最小防御。完全な意味照合は今回のスコープ外の残存リスク)。
  // - MAJOR5: owner_profile/owner_career/owner_philosophy/conceptは、本人発信の
  //   一次情報(official_site/official_sns)以外の本文取得成功では根拠にしない
  //   (第三者グルメサイト・記事の取得成功だけでは「本人発信」を保証できないため)。
  // - 実機smoke事故: `url_context_status==="success"`(=ページ取得成功)だけでは
  //   「対象店舗のページだった」ことを一切保証しない。`identity_status`
  //   (`isIdentityAcceptableForItem`)による識別確認を必須にする。
  const requiresPrimarySource = PRIMARY_SOURCE_REQUIRED_KEYS.has(item.key);
  const verifiedIds = new Set(
    context.sourceRegistry
      .filter((entry) => {
        if (entry.url_context_status !== "success") return false;
        if (entry.source_type === "competitor") return false;
        if (requiresPrimarySource && !PRIMARY_SOURCE_TYPES.has(entry.source_type)) return false;
        if (!isIdentityAcceptableForItem(entry, item.key)) return false;
        return true;
      })
      .map((entry) => entry.id),
  );
  const hasVerifiedSource = item.source_ids.some((id) => verifiedIds.has(id));

  // Tier B: reliable secondary evidence(feat/ai-research-quality-refinement、
  // feat/ai-research-pre-smoke-hardingでSearchFact.valueそのものをtrust boundaryへ
  // 組み込むよう強化)。gourmet_site/reservation_site等はURL Context本文取得に
  // 失敗しやすいが、Stage1のGoogle Search時点でSearchFactとして具体的な値が
  // 確認できることがある。単なるsource_type一致ではなく、(1) keyが一致する
  // SearchFactの存在、(2) そのsourceの`deriveTrustedSourceType`が許可済みsource_type
  // であること、の両方を必須とする。自己申告typeのみのsourceは対象外(MAJOR6)。
  //
  // SearchFact.value自体もStage1モデルがGoogle Search結果を読んで生成した値であり
  // 「無条件に真実」ではない(追加修正C)。同一keyについて信頼済みSearchFactの値が
  // 複数かつ異なる場合は、どちらが正しいか機械的に判断できないためconfirmedにしない
  // (false positiveよりfalse negativeを優先)。
  //
  // fix/ai-research-source-identity-integrity: 加えて`isTierBEligible`
  // (`known_store_data`のみ)を必須にする。第三者(hostname trustのみ)のSearchFact-only
  // エビデンスは、URL Context本文取得すら経ていないため`source_verifications`による
  // 識別確認の機会が無く、trusted hostnameであっても実際に対象店舗のページを指している
  // 保証が無い(今回のHotPepper誤URL事故の教訓)。
  const allowedSourceTypes = SOURCE_TRUST_MATRIX[item.key];
  const trustedFactsForKey =
    allowedSourceTypes === undefined
      ? []
      : (context.searchFacts ?? []).filter((fact) => {
          if (fact.key !== item.key || fact.value.trim() === "") return false;
          if (!item.source_ids.includes(fact.sourceId)) return false;
          const entry = context.sourceRegistry.find((e) => e.id === fact.sourceId);
          if (entry === undefined) return false;
          if (!isTierBEligible(entry)) return false;
          const trustedType = deriveTrustedSourceType(entry);
          return trustedType !== undefined && allowedSourceTypes.includes(trustedType);
        });
  const distinctFactValues = new Set(trustedFactsForKey.map((f) => f.value.trim()));
  const isAggregationKey = MULTI_SOURCE_AGGREGATION_KEYS.has(item.key);
  const hasSearchFactMatch =
    trustedFactsForKey.length > 0 && (isAggregationKey || distinctFactValues.size === 1);

  if (isPlacesVerified || hasVerifiedSource || hasSearchFactMatch) {
    type SingleBasis = Exclude<EvidenceBasis, "mixed">;
    const bases = (
      [
        isPlacesVerified ? "places" : null,
        hasVerifiedSource ? "url_context" : null,
        hasSearchFactMatch ? "search_note" : null,
      ] as const
    ).filter((b): b is SingleBasis => b !== null);
    const evidence_basis: EvidenceBasis = bases.length > 1 ? "mixed" : bases[0]!;

    // Tier B(SearchFact)のみを根拠にconfirmedを維持する場合、AIの自由記述value
    // ではなくSearchFact側の値をcanonicalとしてvalueを再構築する(BLOCKER3)。
    // Places/URL Contextによる裏付けが同時にある場合(mixed/url_context/places)は、
    // より強い根拠(実データ確認)であるAIのvalueをそのまま維持する。
    // `isAggregationKey`(例: media_coverage)は、この関数を呼ぶ前段の
    // `pipeline.ts:upgradeMediaCoverageFromRegistry`が既に複数sourceを集約した
    // canonical value/source_idsを構築済みのため、ここで単一factの値へ
    // 差し替えると集約結果が壊れる(fix/ai-research-final-audit-hardening)。
    if (evidence_basis === "search_note" && !isAggregationKey) {
      const canonicalValue = trustedFactsForKey[0]!.value;
      const factSourceIds = Array.from(new Set(trustedFactsForKey.map((f) => f.sourceId)));
      return {
        ...item,
        value: canonicalValue,
        evidence: `Web検索結果で確認できた情報です(${canonicalValue})。`,
        source_ids: factSourceIds,
        candidates: undefined,
        warning: undefined,
        evidence_basis,
      };
    }

    return { ...item, evidence_basis };
  }

  const downgradedStatus = getConfirmedDowngradeStatus(item.research_policy);
  const downgradeNote =
    "AIはconfirmedと判定しましたが、根拠となる情報源の本文取得が確認できなかったため自動的に格下げしました。";

  return {
    ...nullifyForNoInfoStatus(item, downgradedStatus),
    status: downgradedStatus,
    warning: appendWarning(item.warning, downgradeNote),
  };
}

/**
 * no-infoステータス(not_found/hearing_required/external_data_required)へ降格する際、
 * `value`/`confidence`/`candidates`を`null`化する(feat/ai-research-quality-refinement)。
 * `inferred`への降格のみ、弱い根拠付きの推定値として現状維持する(唯一の例外)。
 */
function nullifyForNoInfoStatus(item: ResearchItem, targetStatus: ResearchStatus): ResearchItem {
  if (targetStatus === "inferred") return item;
  return {
    ...item,
    value: null,
    confidence: null,
    candidates: undefined,
    evidence: deterministicEvidenceForNoInfoStatus(targetStatus),
  };
}

/**
 * no-infoステータスへ降格・補正した際、statusと矛盾しないevidenceへ置き換える
 * (feat/ai-research-final-quality)。AIが元status前提で書いたevidence(例:
 * 「...のためヒアリングが必要です」)が、機械補正後のstatus(例: not_found)と
 * 矛盾したまま残る実バグの再発防止。
 */
function deterministicEvidenceForNoInfoStatus(status: ResearchStatus): string {
  switch (status) {
    case "not_found":
      return "Web上で確認できませんでした。";
    case "hearing_required":
      return "Web上の本人発信で確認できないため、営業時のヒアリングが必要です。";
    case "external_data_required":
      return "現在のWeb調査方式では正確な値を取得できないため、対象外です。";
    default:
      return "";
  }
}

/** research_policy ごとの confirmed 降格先。 */
function getConfirmedDowngradeStatus(
  policy: z.infer<typeof ResearchPolicySchema>,
): ResearchStatus {
  switch (policy) {
    case "FACT":
      return "not_found";
    case "ANALYSIS":
      return "inferred";
    case "FACT_OR_HEARING":
      return "hearing_required";
    case "HEARING_ONLY":
      return "hearing_required";
    case "EXTERNAL_DATA_REQUIRED":
      return "external_data_required";
  }
}

/* ------------------------------------------------------------------ */
/*  research_policy と status の整合性 (feat/ai-research-quality-refinement) */
/* ------------------------------------------------------------------ */

/**
 * research_policy ごとに許可される status の集合。`Record<ResearchPolicy, ...>` の
 * 型注釈により5値全てのキーを型レベルで強制する(1つでも欠けるとコンパイルエラー)。
 */
const ALLOWED_STATUSES_BY_POLICY: Record<ResearchPolicy, readonly ResearchStatus[]> = {
  FACT: ["confirmed", "conflict", "not_found"],
  ANALYSIS: ["confirmed", "inferred", "conflict", "not_found"],
  FACT_OR_HEARING: ["confirmed", "hearing_required"],
  HEARING_ONLY: ["hearing_required"],
  EXTERNAL_DATA_REQUIRED: ["external_data_required"],
};

/**
 * research_policyとstatusの組み合わせ自体が不正な場合のfallback先。
 *
 * `getConfirmedDowngradeStatus`(confirmedだが根拠不十分、という別シナリオ用で
 * ANALYSISに対し`inferred`を返す)とは意図的に別関数にしている。こちらは
 * 「AIの主張するstatus自体が policy と矛盾している」という、値の信頼性そのものが
 * 疑わしいシナリオのため、ANALYSISであっても`inferred`(弱い根拠付きの推定値を
 * 維持する想定の値)ではなく`not_found`へ倒す、より保守的な判断をする。
 */
function getInvalidStatusFallback(policy: ResearchPolicy): ResearchStatus {
  switch (policy) {
    case "FACT":
    case "ANALYSIS":
      return "not_found";
    case "FACT_OR_HEARING":
      return "hearing_required";
    case "HEARING_ONLY":
      return "hearing_required";
    case "EXTERNAL_DATA_REQUIRED":
      return "external_data_required";
  }
}

/**
 * `item.status`が(補正済みの)`item.research_policy`に対して許可されない値の場合、
 * `getInvalidStatusFallback`が返す既定status(常にnot_found/hearing_required/
 * external_data_requiredのいずれか)へ補正する。「ヒアリング必要なのにAI推測値が
 * 残る」状態を作らないため、`value`/`confidence`/`candidates`は無条件でnull化する。
 *
 * 呼び出し前提: `enforceResearchPolicy`を先に適用済みであること
 * (`applyDeterministicValidation`はこの順序を保証する)。
 *
 * 純関数。入力を変更せず、新しい `ResearchItem` を返す。
 */
export function enforceStatusForPolicy(item: ResearchItem): ResearchItem {
  const allowed = ALLOWED_STATUSES_BY_POLICY[item.research_policy];
  if (allowed.includes(item.status)) return item;

  const fallback = getInvalidStatusFallback(item.research_policy);
  return {
    ...nullifyForNoInfoStatus(item, fallback),
    status: fallback,
    warning: appendWarning(
      item.warning,
      `research_policy=${item.research_policy}に対し不正なstatus(${item.status})だったため${fallback}へ補正しました。`,
    ),
  };
}

/**
 * status/value/candidatesの最終不変条件(feat/ai-research-pre-smoke-hardening、MAJOR4)。
 *
 * これまでの検証関数(`enforceStatusForPolicy`/`validateResearchItemStatus`)は
 * 「confirmedから降格した場合」等、特定の遷移が発生したときにのみvalueのnull化を
 * 行っていた。しかしAIが**最初から**policy的には合法だが自己矛盾した応答
 * (例: `{status: "not_found", value: "17:00-24:00"}`)を返した場合、どの遷移も
 * 発生しないためnull化されずに素通りしてしまうbugがあった。本関数は遷移の有無に
 * 関わらず、最終的なstatusとvalue/confidence/candidatesの整合を無条件に強制する:
 *
 * - confirmed/inferred: valueがnon-null・trim後non-emptyであること。満たさなければ
 *   `getInvalidStatusFallback`と同じ考え方でpolicyごとの安全なno-infoステータスへ
 *   降格する(「値が無いのにconfirmed/inferredを名乗る」状態を許さない)。
 * - not_found/hearing_required/external_data_required: value/confidence/candidatesを
 *   無条件でnull化する(既にnull化済みなら何もしない)。
 * - conflict: 形状の妥当性は`validateConflictShape`が既に保証しているため、
 *   本関数では変更しない。
 *
 * 呼び出し前提: `validateResearchItemStatus`の後に適用すること
 * (`applyDeterministicValidation`はこの順序を保証する)。
 *
 * 純関数。入力を変更せず、新しい `ResearchItem` を返す。
 */
export function enforceStatusValueInvariant(item: ResearchItem): ResearchItem {
  if (
    item.status === "not_found" ||
    item.status === "hearing_required" ||
    item.status === "external_data_required"
  ) {
    const alreadyNullified =
      item.value === null &&
      (item.confidence === null || item.confidence === undefined) &&
      (item.candidates === undefined || item.candidates === null);
    if (alreadyNullified) return item;
    return nullifyForNoInfoStatus(item, item.status);
  }

  if (item.status === "confirmed" || item.status === "inferred") {
    if (item.value !== null && item.value.trim() !== "") return item;
    const fallback = getInvalidStatusFallback(item.research_policy);
    return {
      ...nullifyForNoInfoStatus(item, fallback),
      status: fallback,
      warning: appendWarning(
        item.warning,
        `status=${item.status}ですが値が空だったため${fallback}へ補正しました。`,
      ),
    };
  }

  return item;
}

/**
 * 1項目に対し、決定的な検証パイプラインを順序どおりに適用する:
 * `enforceResearchPolicy` → `enforceStatusForPolicy` → `sanitizeSourceIds` →
 * `validateConflictShape` → `validateResearchItemStatus`。この順序には意味があり、
 * 後段は前段の是正結果を前提とする(例: confirmed判定は sanitize 済みの
 * source_ids のみを見る)。
 *
 * 純関数。入力を変更せず、新しい `ResearchItem` を返す。
 */
export function applyDeterministicValidation(
  item: ResearchItem,
  context: ResearchValidationContext,
): ResearchItem {
  const policyEnforced = enforceResearchPolicy(item);
  const statusEnforced = enforceStatusForPolicy(policyEnforced);
  const sourceIdsSanitized = sanitizeSourceIds(statusEnforced, context.sourceRegistry);
  const conflictValidated = validateConflictShape(sourceIdsSanitized);
  const statusValidated = validateResearchItemStatus(conflictValidated, context);
  const invariantEnforced = enforceStatusValueInvariant(statusValidated);
  const sourceIdsPruned = pruneUnverifiedSourceIds(invariantEnforced, context);
  return flagEvidenceSourceIdMismatch(sourceIdsPruned);
}

/**
 * confirmed維持の判定自体には他の検証済みsourceで十分な場合でも、実際には検証に
 * 寄与していない(url_context成功でもkey一致のSearchFactでもない)source_idsが
 * 混在したままUIへ表示されないよう、最終段で刈り込む(feat/ai-research-final-quality)。
 *
 * 「1件でも正しいsourceがあればconfirmedを維持してよい」ことと「無関係・未検証の
 * sourceまでUIの根拠として見せる」ことは別の問題であり、本関数は後者のみを扱う。
 * `validateResearchItemStatus`が既にconfirmed可否を判定した**後**に適用するため、
 * 判定結果自体は変えない(表示のノイズ削減のみ)。全件除去されてしまう場合は
 * (根拠が丸ごと消えて見えるほうが不自然なため)除去せず元のまま残す。
 *
 * 純関数。入力を変更せず、新しい `ResearchItem` を返す。
 */
export function pruneUnverifiedSourceIds(
  item: ResearchItem,
  context: ResearchValidationContext,
): ResearchItem {
  // fix/ai-research-source-identity-integrity: url_context成功済みでも識別確認
  // (`identity_status`)が対象keyのカテゴリに適合しないsourceは、判定に寄与していない
  // ことと同様に表示からも刈り込む(誤ったURLが「確認済み」リンクとしてUIに残る
  // 実機smoke事故の再発防止、`validateResearchItemStatus`のpath 2と同じ基準を使う)。
  const verifiedIds = new Set(
    context.sourceRegistry
      .filter(
        (entry) =>
          entry.url_context_status === "success" && isIdentityAcceptableForItem(entry, item.key),
      )
      .map((entry) => entry.id),
  );
  const searchFactIdsForKey = new Set(
    (context.searchFacts ?? [])
      .filter((fact) => fact.key === item.key)
      .map((fact) => fact.sourceId)
      .filter((sourceId) => {
        const entry = context.sourceRegistry.find((e) => e.id === sourceId);
        return entry !== undefined && isTierBEligible(entry);
      }),
  );
  const isKept = (id: string): boolean => verifiedIds.has(id) || searchFactIdsForKey.has(id);

  const filteredSourceIds =
    item.source_ids.length === 0
      ? item.source_ids
      : (() => {
          const filtered = item.source_ids.filter(isKept);
          return filtered.length > 0 ? filtered : item.source_ids;
        })();

  const filteredCandidates = item.candidates?.map((candidate) => {
    if (candidate.source_ids.length === 0) return candidate;
    const filtered = candidate.source_ids.filter(isKept);
    return filtered.length > 0 ? { ...candidate, source_ids: filtered } : candidate;
  });

  const sourceIdsChanged = filteredSourceIds !== item.source_ids;
  const candidatesChanged =
    filteredCandidates !== undefined &&
    filteredCandidates.some((c, i) => c !== item.candidates?.[i]);

  if (!sourceIdsChanged && !candidatesChanged) return item;
  return {
    ...item,
    source_ids: filteredSourceIds,
    candidates: candidatesChanged ? filteredCandidates : item.candidates,
  };
}

/**
 * `S01`/`S05`等のsource ID表記が`item.evidence`本文に直接埋め込まれ、かつその
 * IDが`item.source_ids`(prune後)に含まれていない場合、warningを付与する
 * (fix/ai-research-source-identity-integrity、FIX11)。
 *
 * 実機smokeで、evidence本文が「S05ぐるなびによると」等具体的なsource IDを含む一方、
 * source_ids配列が別の(または刈り込まれた)ID集合になっており、UIのsource badgeと
 * evidence本文の説明が食い違う不整合が確認された。evidence本文の自由文字列を
 * 機械的に安全に書き換えることはできない(文脈を壊すリスクがある)ため、ここでは
 * 検出してwarningを付与するに留める。source_idsをcanonical provenanceとして扱う
 * (Stage2 promptにも evidence本文へsource IDを書かせない指示を追加済み)。
 *
 * 純関数。入力を変更せず、新しい `ResearchItem` を返す。
 */
const EVIDENCE_SOURCE_ID_PATTERN = /\bS\d{2,3}\b/g;

export function flagEvidenceSourceIdMismatch(item: ResearchItem): ResearchItem {
  if (!item.evidence) return item;
  const mentioned = item.evidence.match(EVIDENCE_SOURCE_ID_PATTERN);
  if (!mentioned) return item;
  const sourceIdSet = new Set(item.source_ids);
  const hasStaleReference = mentioned.some((id) => !sourceIdSet.has(id));
  if (!hasStaleReference) return item;
  return {
    ...item,
    warning: appendWarning(
      item.warning,
      "evidence内の出典表記がsource_idsと一致しない可能性があります。",
    ),
  };
}

/** `applyDeterministicValidation` を複数項目へ一括適用する。 */
export function validateResearchItems(
  items: readonly ResearchItem[],
  context: ResearchValidationContext,
): ResearchItem[] {
  return items.map((item) => applyDeterministicValidation(item, context));
}

function appendWarning(existing: string | null | undefined, addition: string): string {
  return existing ? `${addition} ${existing}` : addition;
}

/* ------------------------------------------------------------------ */
/*  最終結果の不変条件 (feat/ai-research-pre-smoke-hardening, BLOCKER1)   */
/* ------------------------------------------------------------------ */

/** `RESEARCH_POLICY_ITEMS`のkey順(canonical順)。件数はハードコードせず動的に導出する。 */
const CANONICAL_KEY_ORDER: readonly string[] = RESEARCH_POLICY_ITEMS.map((i) => i.key);
const CANONICAL_KEY_SET: ReadonlySet<string> = new Set(CANONICAL_KEY_ORDER);
const CANONICAL_KEY_INDEX: ReadonlyMap<string, number> = new Map(
  CANONICAL_KEY_ORDER.map((key, index) => [key, index]),
);

/**
 * 最終itemsを`RESEARCH_POLICY_ITEMS`の並び順(canonical順)へ並べ替える
 * (feat/ai-research-pre-smoke-hardening、BLOCKER1)。モデルの出力順にUIの表示順を
 * 依存させないための、保存直前のdeterministicなソート。未知keyは末尾へ回す
 * (`validateFinalResearchResultIntegrity`が別途これを検出しfailedにするため、
 * ソート自体は落ちない安全側の実装のみでよい)。
 *
 * 純関数。入力配列を変更せず、新しい配列を返す。
 */
export function sortResearchItemsToCanonicalOrder(
  items: readonly ResearchItem[],
): ResearchItem[] {
  return [...items].sort((a, b) => {
    const ai = CANONICAL_KEY_INDEX.get(a.key) ?? CANONICAL_KEY_ORDER.length;
    const bi = CANONICAL_KEY_INDEX.get(b.key) ?? CANONICAL_KEY_ORDER.length;
    return ai - bi;
  });
}

export interface FinalResultIntegrityViolation {
  /** sanitizedな種別トークン(エラーメッセージ・observabilityへそのまま使ってよい)。 */
  kind:
    | "item_count_mismatch"
    | "key_set_mismatch"
    | "duplicate_key"
    | "unknown_key";
}

/**
 * `persistSucceededStep`直前に適用する最終結果の不変条件チェック(feat/ai-research-pre-smoke-hardening、
 * BLOCKER1)。1つでも違反があれば、そのrunをsucceededとして保存してはならない。
 *
 * 検証する件数・key集合は`RESEARCH_POLICY_ITEMS`から動的に導出し、53等の値を
 * コードへハードコードしない(そのrunのallowedKeys.length等と同じ設計原則)。
 *
 * - exactly `RESEARCH_POLICY_ITEMS.length`件であること。
 * - key集合が`RESEARCH_POLICY_ITEMS`のkey集合と完全一致すること(不足・過剰なし)。
 * - keyの重複が無いこと。
 *
 * 違反が無ければ`null`を返す。純関数。
 */
export function validateFinalResearchResultIntegrity(
  items: readonly ResearchItem[],
): FinalResultIntegrityViolation | null {
  const keys = items.map((item) => item.key);
  const keySet = new Set(keys);

  if (keys.length !== keySet.size) {
    return { kind: "duplicate_key" };
  }
  if (keys.some((key) => !CANONICAL_KEY_SET.has(key))) {
    return { kind: "unknown_key" };
  }
  if (items.length !== CANONICAL_KEY_ORDER.length) {
    return { kind: "item_count_mismatch" };
  }
  for (const key of CANONICAL_KEY_ORDER) {
    if (!keySet.has(key)) {
      return { kind: "key_set_mismatch" };
    }
  }
  return null;
}
