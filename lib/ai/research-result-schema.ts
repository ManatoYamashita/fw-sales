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
import { RESEARCH_POLICIES, getResearchPolicy } from "@/lib/domain/research-policy";

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
 * Source Registry の由来。現状は Google Search grounding metadata 由来のみ
 * (モデルが自由生成した URL は登録しない、Plan v3.2 §8)。将来の由来追加に
 * 備えて union として定義するが、現時点では単一値のみ許可する。
 *
 * Google Places 由来の値(`store_name`/`address`/`cuisine_genre`/`phone`/
 * `review_avg`/`review_count`)は本 Source Registry には**登録しない**
 * (Web Source専用のまま維持、PR1 fresh review 反映)。Places 検証済みの
 * confirmed 根拠は `validateResearchItemStatus` の `placesVerifiedKeys`
 * コンテキストで別経路として扱う(下記)。
 */
export const DISCOVERY_PROVENANCES = ["google_grounding"] as const;
export type DiscoveryProvenance = (typeof DISCOVERY_PROVENANCES)[number];

export const SourceRegistryEntrySchema = z.object({
  /** run内で一意・連番の ID ("S01", "S02", ...)。モデルはこの ID のみを参照する。 */
  id: z.string(),
  /** groundingChunks[].title 由来(ホスト名相当)。 */
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
});
export type SourceRegistryEntry = z.infer<typeof SourceRegistryEntrySchema>;

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
 * - `status === "conflict"` の項目は `candidates` が非空であること。空/欠落なら
 *   confirmedの根拠なしと同様に扱えないため `not_found` へ降格する
 *   (「候補を提示できないのに競合と主張する」という矛盾した状態を許さない)。
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
  if (candidates.length === 0) {
    return {
      ...item,
      status: "not_found",
      candidates: undefined,
      warning: appendWarning(
        item.warning,
        "AIがconflictと判定しましたが候補が提示されなかったため無効化しました。",
      ),
    };
  }

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
}

/**
 * AIが返した `status` をそのまま信用しない。`status==="confirmed"` の項目は、
 * 以下のいずれかを満たす場合のみ confirmed を維持する:
 *
 * 1. `context.placesVerifiedKeys` に `item.key` が含まれる(最新Google Placesで
 *    検証済み、Plan v3.2 PR1 fresh review A)。
 * 2. `source_ids` が `url_context_status==="success"` の Source Registry エントリを
 *    少なくとも1件含む(Web調査で本文取得に成功した根拠がある)。
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
 * 「Google Searchだけで見つかりURL Contextで本文取得できなかったsource」は
 * 検証対象から除外される(= confirmedの根拠として使わない、Plan v3.2 §5)。
 *
 * 呼び出し前提: `enforceResearchPolicy` / `sanitizeSourceIds` / `validateConflictShape`
 * を先に適用済みであること(`applyDeterministicValidation` はこの順序を保証する)。
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
    return {
      ...item,
      status: getConfirmedDowngradeStatus(item.research_policy),
      warning: appendWarning(
        item.warning,
        `research_policy=${item.research_policy}の項目はAIがconfirmedと判定できないため自動的に格下げしました。`,
      ),
    };
  }

  if (context.placesVerifiedKeys?.has(item.key)) return item;

  const verifiedIds = new Set(
    context.sourceRegistry
      .filter((entry) => entry.url_context_status === "success")
      .map((entry) => entry.id),
  );
  const hasVerifiedSource = item.source_ids.some((id) => verifiedIds.has(id));
  if (hasVerifiedSource) return item;

  const downgradedStatus = getConfirmedDowngradeStatus(item.research_policy);
  const downgradeNote =
    "AIはconfirmedと判定しましたが、根拠となる情報源の本文取得が確認できなかったため自動的に格下げしました。";

  return {
    ...item,
    status: downgradedStatus,
    warning: appendWarning(item.warning, downgradeNote),
  };
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

/**
 * 1項目に対し、決定的な検証パイプラインを順序どおりに適用する:
 * `enforceResearchPolicy` → `sanitizeSourceIds` → `validateConflictShape` →
 * `validateResearchItemStatus`。この順序には意味があり、後段は前段の是正結果を
 * 前提とする(例: confirmed判定は sanitize 済みの source_ids のみを見る)。
 *
 * 純関数。入力を変更せず、新しい `ResearchItem` を返す。
 */
export function applyDeterministicValidation(
  item: ResearchItem,
  context: ResearchValidationContext,
): ResearchItem {
  const policyEnforced = enforceResearchPolicy(item);
  const sourceIdsSanitized = sanitizeSourceIds(policyEnforced, context.sourceRegistry);
  const conflictValidated = validateConflictShape(sourceIdsSanitized);
  return validateResearchItemStatus(conflictValidated, context);
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
