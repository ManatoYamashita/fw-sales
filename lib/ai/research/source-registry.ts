/**
 * Stage 1 の Google Search grounding metadata / モデル自由記述からSource Registryを構築する。
 * AI 店舗調査再設計(Plan v3.2 §8「Source Registry構築ルール」、PR2、
 * fix/ai-research-poc-like-retrieval で全面改訂)。
 *
 * ## 改訂の背景(Spike 0.2/0.3の実証結果)
 *
 * 旧設計は「公式 `groundingMetadata.groundingChunks` のみを Source of Truth とし、
 * モデルが自由記述した `[SOURCE]` ブロックの URL は登録しない」という方針だった。
 * しかし実機検証(Spike 0.2: 2店舗、Spike 0.3: Interactions API)の結果、
 * `groundingMetadata` は一貫して欠落することが判明し、この方針では
 * Source Registry が恒常的に0件になり、53項目のほぼ全てが `not_found` に
 * 陥る品質劣化を引き起こしていた。
 *
 * PoC(YELLOW PIZZA で confirmed 29 / inferred 12 を達成)の実績を踏まえ、
 * 「モデル生成URLは**候補**として使う。実ページをURL Contextで取得できたものだけ、
 * 最終的な根拠として信用する」という方針に転換する。信頼境界は Source Registry への
 * 登録可否ではなく、`applyDeterministicValidation`(`lib/ai/research-result-schema.ts`)の
 * `url_context_status==="success"` 判定に置く(このロジック自体は変更しない)。
 *
 * 手順:
 * 1. `groundingMetadata.groundingChunks[]`(取得できれば最優先、`discovery_provenance:
 *    "google_grounding"`)。
 * 2. モデル自由記述の `[SOURCE]` ブロックのうち、1で登録されなかったURLを
 *    `discovery_provenance: "gemini_search_candidate"` として候補登録する。
 * 3. 最低限のURL形式チェックのみ実施する(http/https限定、credentials拒否、空文字拒否)。
 *    自前DNS lookup・SSRF対策等の重い検証は行わない(Stage2はfw-salesサーバー自身が
 *    URL本文を取得するのではなく、Gemini URL Contextへ渡すだけのため)。
 * 4. 重複除去・最大15件程度への制限。
 *
 * `known_store_data`(`stores.site_url`/`stores.instagram_url`)は本モジュールでは扱わず、
 * `buildKnownStoreDataEntries`/`mergeKnownStoreDataIntoRegistry` として別関数を提供する
 * (Geminiの応答に依存しないため)。
 */

import type { SourceRegistryEntry, SourceType } from "@/lib/ai/research-result-schema";
import { SOURCE_TYPES } from "@/lib/ai/research-result-schema";
import { getResearchPolicy } from "@/lib/domain/research-policy";

/** `@google/genai` の `GroundingChunk` を模した最小限の形状。SDK型への直接依存を避ける。 */
export interface GroundingChunkLike {
  web?: { uri?: string | null; title?: string | null } | null;
}

/** `@google/genai` の `GroundingMetadata` を模した最小限の形状。 */
export interface GroundingMetadataLike {
  groundingChunks?: GroundingChunkLike[] | null;
}

export interface ParsedSourceBlock {
  url: string;
  title: string;
  type: string;
  whyUseful: string;
}

/** Source Registry に登録するcandidate URLの上限件数(Plan踏襲、PoC実績とも整合)。 */
const MAX_SOURCE_REGISTRY_ENTRIES = 15;

/**
 * Stage1 Search Notes(`[SEARCH_NOTE]`ブロック)の種別
 * (feat/ai-research-source-diversity、口コミ・グルメサイト由来の情報活用強化)。
 *
 * - `store_fact`: 営業時間・席数・客単価等、客観的な店舗スペック情報。
 * - `review_signal`: 好意的な口コミ傾向・利用シーンの言及。
 * - `negative_review_signal`: 不満・改善点として言及された口コミ傾向。
 * - `usage_signal`: デート・宴会・仕事帰り等、実際の利用シーンの言及。
 */
export const SEARCH_NOTE_KINDS = [
  "store_fact",
  "review_signal",
  "negative_review_signal",
  "usage_signal",
] as const;
export type SearchNoteKind = (typeof SEARCH_NOTE_KINDS)[number];

export interface SearchNote {
  sourceUrl: string;
  kind: SearchNoteKind;
  summary: string;
  /**
   * `kind==="store_fact"`の場合のみ意味を持つ構造化フィールド(feat/ai-research-quality-refinement)。
   * `key`は53項目のkeyのいずれか、`value`は確認できた具体的な値。両方揃わない場合は
   * undefinedのまま(Tier Bの`SearchFact`照合には使えないが、`summary`は引き続き
   * プロンプト表示用に利用できる)。
   */
  key?: string;
  value?: string;
}

/** 1件のSearch Note summaryの最大文字数(prompt肥大化防止、レビュー全文コピペ禁止)。 */
const MAX_SEARCH_NOTE_SUMMARY_LENGTH = 200;
/** Search Notesの最大件数(prompt肥大化防止)。 */
const MAX_SEARCH_NOTES = 20;

/**
 * Stage1 モデル応答の自由記述テキストから `[SOURCE]...[/SOURCE]` ブロックを抽出する。
 * PoC (`gemini-research-poc/run-standard-research.mjs` の `parseDiscoveredSources`) と
 * 同一の書式を踏襲する。
 */
export function parseSourceBlocks(text: string): ParsedSourceBlock[] {
  const blocks: ParsedSourceBlock[] = [];
  const blockRe = /\[SOURCE\]([\s\S]*?)\[\/SOURCE\]/g;
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(text)) !== null) {
    const body = match[1] ?? "";
    const url = extractField(body, "url");
    if (!url) continue;
    blocks.push({
      url,
      title: extractField(body, "title") ?? "",
      type: extractField(body, "type") ?? "",
      whyUseful: extractField(body, "why_useful") ?? "",
    });
  }
  return blocks;
}

function extractField(block: string, fieldName: string): string | null {
  const re = new RegExp(`^\\s*${fieldName}:\\s*(.+)$`, "mi");
  const m = block.match(re);
  return m?.[1]?.trim() ?? null;
}

function isSearchNoteKind(raw: string | null): raw is SearchNoteKind {
  return raw !== null && (SEARCH_NOTE_KINDS as readonly string[]).includes(raw);
}

/**
 * Stage1 モデル応答の自由記述テキストから `[SEARCH_NOTE]...[/SEARCH_NOTE]` ブロックを抽出する
 * (feat/ai-research-source-diversity)。
 *
 * Google Search実行時に得られた検索結果由来の補助情報(URL Context本文取得より一段弱い根拠)。
 * `kind`が未知の値のブロックは破棄する(想定外の分類をStage2へ渡さない安全側)。
 * `summary`は{@link MAX_SEARCH_NOTE_SUMMARY_LENGTH}文字で切り詰め、
 * 全体件数も{@link MAX_SEARCH_NOTES}件までに制限する(prompt肥大化防止、
 * レビュー全文・生のAPI応答を保存しない方針)。
 */
export function parseSearchNotes(text: string): SearchNote[] {
  const notes: SearchNote[] = [];
  const blockRe = /\[SEARCH_NOTE\]([\s\S]*?)\[\/SEARCH_NOTE\]/g;
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(text)) !== null) {
    if (notes.length >= MAX_SEARCH_NOTES) break;
    const body = match[1] ?? "";
    const sourceUrl = extractField(body, "source_url");
    const kind = extractField(body, "kind");
    const summary = extractField(body, "summary");
    if (!sourceUrl || !isValidCandidateUrl(sourceUrl)) continue;
    if (!isSearchNoteKind(kind)) continue;
    if (!summary) continue;

    const note: SearchNote = {
      sourceUrl,
      kind,
      summary:
        summary.length > MAX_SEARCH_NOTE_SUMMARY_LENGTH
          ? `${summary.slice(0, MAX_SEARCH_NOTE_SUMMARY_LENGTH)}…`
          : summary,
    };

    // kind==="store_fact"の場合のみ、key/valueを構造化フィールドとして付与する
    // (feat/ai-research-quality-refinement、Tier BのSearchFact照合に使う)。
    // keyは53項目のkeyのいずれかであることを検証し、不一致・未知keyは破棄する
    // (捏造されたkeyをTier B判定に紛れ込ませない安全側)。
    if (kind === "store_fact") {
      const key = extractField(body, "key");
      const value = extractField(body, "value");
      if (key && value && getResearchPolicy(key) !== undefined) {
        note.key = key;
        note.value = value;
      }
    }

    notes.push(note);
  }
  return notes;
}

function toSourceType(raw: string): SourceType {
  return (SOURCE_TYPES as readonly string[]).includes(raw) ? (raw as SourceType) : "other";
}

/**
 * 最低限のURL形式チェックのみ実施する(要件どおり、過剰な自前resolverは行わない)。
 *
 * - URLとしてparse可能
 * - protocolは http: / https: のみ(javascript: / file: / data: 等を拒否)
 * - username/password付きURL(`user:pass@host`)を拒否
 * - 空文字を拒否
 *
 * これ以上(自前DNS lookup・IP range検査・redirect hop検査等)は行わない。
 * Stage2ではfw-salesサーバー自身が任意URL本文をfetchするのではなく、
 * Gemini URL ContextへURLを渡して取得させるため、SSRF対策の主眼は
 * Gemini側にある(fw-sales側は明らかに不正な形式のURLを弾く程度でよい)。
 */
export function isValidCandidateUrl(raw: string): boolean {
  if (typeof raw !== "string") return false;
  const trimmed = raw.trim();
  if (trimmed === "") return false;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (parsed.username !== "" || parsed.password !== "") return false;

  return true;
}

type DraftEntry = Omit<SourceRegistryEntry, "id">;

function assignSequentialIds(drafts: readonly DraftEntry[]): SourceRegistryEntry[] {
  return drafts.map((draft, index) => ({
    ...draft,
    id: `S${String(index + 1).padStart(2, "0")}`,
  }));
}

/**
 * Source Registryの用途別バケット(feat/ai-research-source-diversity)。
 * 「reviews/social」専用の`source_type`は存在しないため、口コミサイトの多くが
 * 分類される`gourmet_site`/`reservation_site`へ統合する。
 */
type SourceBucket = "official" | "gourmet_reservation" | "article_local" | "competitor" | "other";

function bucketOf(sourceType: SourceType): SourceBucket {
  switch (sourceType) {
    case "official_site":
    case "official_sns":
      return "official";
    case "gourmet_site":
    case "reservation_site":
      return "gourmet_reservation";
    case "article":
    case "local_official":
      return "article_local";
    case "competitor":
      return "competitor";
    case "google":
    case "public_data":
    case "other":
      return "other";
  }
}

/**
 * 各バケットのソフト上限(目安、ユーザー要望の「official 1〜3 / gourmet・reservation
 * 3〜5 / reviews・social 2〜4(gourmet_reservationへ統合) / local article 1〜3 /
 * competitor 2〜3」に基づく)。あくまでソフト上限であり、他バケットに空きがあれば
 * `capWithDiversity`のbackfillで埋め戻される(全体枠を無駄にしない)。
 */
const BUCKET_SOFT_CAPS: Record<SourceBucket, number> = {
  official: 3,
  gourmet_reservation: 5,
  article_local: 3,
  competitor: 3,
  other: 2,
};

/** 同一hostnameからの候補が枠を独占しないためのソフト上限。 */
const MAX_PER_DOMAIN = 3;

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * 特定バケット(典型的には公式サイトのみ)がSource Registryの枠を独占しないよう、
 * バケットごと・ドメインごとのソフト上限を適用しつつ選択する(feat/ai-research-source-diversity、
 * 「公式サイトのみで枠を消費しない」「見つからないカテゴリを無理に埋める必要はない」の両立)。
 *
 * 発見順(優先順)を尊重しつつ1パス目でソフト上限内のもののみ採用し、
 * 上限超過で見送った候補は2パス目で残り枠に達するまで順に埋め戻す
 * (多様な候補がある場合はバケット偏重を防ぎ、無い場合は全体枠15件を無駄にしない)。
 *
 * 純関数。
 */
function capWithDiversity(drafts: readonly DraftEntry[], max: number): DraftEntry[] {
  const bucketCounts: Record<SourceBucket, number> = {
    official: 0,
    gourmet_reservation: 0,
    article_local: 0,
    competitor: 0,
    other: 0,
  };
  const domainCounts = new Map<string, number>();
  const admitted: DraftEntry[] = [];
  const deferredByBucket: Record<SourceBucket, DraftEntry[]> = {
    official: [],
    gourmet_reservation: [],
    article_local: [],
    competitor: [],
    other: [],
  };

  for (const draft of drafts) {
    if (admitted.length >= max) break;
    const bucket = bucketOf(draft.source_type);
    const domain = hostnameOf(draft.grounding_redirect_url);
    const domainCount = domainCounts.get(domain) ?? 0;
    if (bucketCounts[bucket] < BUCKET_SOFT_CAPS[bucket] && domainCount < MAX_PER_DOMAIN) {
      admitted.push(draft);
      bucketCounts[bucket] += 1;
      domainCounts.set(domain, domainCount + 1);
    } else {
      deferredByBucket[bucket].push(draft);
    }
  }

  // 残り枠はバケットのround-robinで埋め戻す(発見順の先頭バケットが独占しないように)。
  const bucketOrder: readonly SourceBucket[] = [
    "official",
    "gourmet_reservation",
    "article_local",
    "competitor",
    "other",
  ];
  let addedInRound = true;
  while (admitted.length < max && addedInRound) {
    addedInRound = false;
    for (const bucket of bucketOrder) {
      if (admitted.length >= max) break;
      const draft = deferredByBucket[bucket].shift();
      if (draft !== undefined) {
        admitted.push(draft);
        addedInRound = true;
      }
    }
  }

  return admitted;
}

/**
 * Stage1 の grounding metadata + モデル自由記述テキストから Source Registry を構築する。
 *
 * @param groundingMetadata Stage1 API レスポンスの `candidate.groundingMetadata`
 *   (欠落(`null`/`undefined`)でもStage1を失敗扱いにしない。Spike 0.2で実証済みのとおり、
 *   実機では恒常的に欠落するため、これを必須条件にしない)
 * @param modelFreeText Stage1 API レスポンスの `response.text`(`[SOURCE]` ブロック抽出用)
 */
export function buildSourceRegistry(
  groundingMetadata: GroundingMetadataLike | null | undefined,
  modelFreeText: string,
): SourceRegistryEntry[] {
  const chunks = (groundingMetadata?.groundingChunks ?? []).filter(
    (c): c is GroundingChunkLike & { web: { uri: string } } =>
      typeof c.web?.uri === "string" && c.web.uri.length > 0,
  );
  const sourceBlocks = parseSourceBlocks(modelFreeText);

  const enrichmentByUrl = new Map<string, ParsedSourceBlock>();
  for (const block of sourceBlocks) {
    if (!enrichmentByUrl.has(block.url)) {
      enrichmentByUrl.set(block.url, block);
    }
  }

  const drafts: DraftEntry[] = [];
  const seenUrls = new Set<string>();

  // 1. 公式groundingMetadata由来(取得できれば最優先、discovery_provenance="google_grounding")。
  for (const chunk of chunks) {
    const url = chunk.web.uri;
    if (seenUrls.has(url) || !isValidCandidateUrl(url)) continue;
    seenUrls.add(url);
    const enrichment = enrichmentByUrl.get(url);
    drafts.push({
      title: enrichment?.title || chunk.web.title || url,
      grounding_redirect_url: url,
      resolved_url: null,
      resolve_status: "skipped",
      source_type: enrichment ? toSourceType(enrichment.type) : "other",
      discovery_provenance: "google_grounding",
      url_context_status: "not_attempted",
    });
  }

  // 2. モデル自由記述の[SOURCE]ブロック由来(候補、discovery_provenance="gemini_search_candidate")。
  //    「候補として発見した」という意味のみで、信頼済みという意味は持たない
  //    (confirmedの根拠にできるかはStage2 URL Context取得成功の有無で別途判定される)。
  for (const block of sourceBlocks) {
    if (seenUrls.has(block.url) || !isValidCandidateUrl(block.url)) continue;
    seenUrls.add(block.url);
    drafts.push({
      title: block.title || block.url,
      grounding_redirect_url: block.url,
      resolved_url: null,
      resolve_status: "skipped",
      source_type: toSourceType(block.type),
      discovery_provenance: "gemini_search_candidate",
      url_context_status: "not_attempted",
    });
  }

  return assignSequentialIds(capWithDiversity(drafts, MAX_SOURCE_REGISTRY_ENTRIES));
}

/** `known_store_data` 由来のURL入力(呼び出し側が `stores.site_url` 等から組み立てる)。 */
export interface KnownStoreDataUrl {
  url: string;
  title: string;
  source_type: SourceType;
}

/**
 * `known_store_data`(アプリが既に保持する店舗の公開URL)を Source Registry のエントリ形状へ
 * 変換する。最低限のURL形式チェックと重複除去のみ行う(id未採番、`mergeKnownStoreDataIntoRegistry`
 * 側で最終的なid採番・上限適用を行う)。
 *
 * 注意: URLがDBに存在するだけでは根拠として信用しない(呼び出し側の設計判断と同じ)。
 * ページ内容はStage2 URL Contextで別途確認される。
 */
export function buildKnownStoreDataEntries(
  urls: readonly KnownStoreDataUrl[],
): DraftEntry[] {
  const seen = new Set<string>();
  const drafts: DraftEntry[] = [];
  for (const u of urls) {
    if (seen.has(u.url) || !isValidCandidateUrl(u.url)) continue;
    seen.add(u.url);
    drafts.push({
      title: u.title,
      grounding_redirect_url: u.url,
      resolved_url: null,
      resolve_status: "skipped",
      source_type: u.source_type,
      discovery_provenance: "known_store_data",
      url_context_status: "not_attempted",
    });
  }
  return drafts;
}

/**
 * `known_store_data` エントリを既存の Source Registry(Gemini候補・公式grounding)へ、
 * known_store_data を優先(先頭)にしてマージする。重複URL(既にregistryに存在するURL)は
 * known_store_data側を優先し、Gemini候補側の重複エントリは除去する。
 * 上限(`MAX_SOURCE_REGISTRY_ENTRIES`)適用後、idを先頭から再採番する。
 *
 * 純関数。入力を変更せず、新しい配列を返す。
 */
export function mergeKnownStoreDataIntoRegistry(
  registry: readonly SourceRegistryEntry[],
  knownEntries: readonly DraftEntry[],
): SourceRegistryEntry[] {
  if (knownEntries.length === 0) {
    return assignSequentialIds(capWithDiversity(registry.map(stripId), MAX_SOURCE_REGISTRY_ENTRIES));
  }

  const knownUrls = new Set(knownEntries.map((e) => e.grounding_redirect_url));
  const rest = registry.filter((e) => !knownUrls.has(e.grounding_redirect_url)).map(stripId);
  const merged: DraftEntry[] = [...knownEntries, ...rest];
  return assignSequentialIds(capWithDiversity(merged, MAX_SOURCE_REGISTRY_ENTRIES));
}

function stripId(entry: SourceRegistryEntry): DraftEntry {
  return {
    title: entry.title,
    grounding_redirect_url: entry.grounding_redirect_url,
    resolved_url: entry.resolved_url,
    resolve_status: entry.resolve_status,
    source_type: entry.source_type,
    discovery_provenance: entry.discovery_provenance,
    url_context_status: entry.url_context_status,
  };
}

/**
 * `stores.site_url` / `stores.instagram_url` から `known_store_data` 候補URLを組み立てる。
 * 空文字は除外する(Plan要件どおり)。
 */
export function buildKnownStoreDataUrls(store: {
  site_url: string;
  instagram_url: string;
}): KnownStoreDataUrl[] {
  const urls: KnownStoreDataUrl[] = [];
  if (store.site_url.trim() !== "") {
    urls.push({ url: store.site_url.trim(), title: "公式サイト(登録情報)", source_type: "official_site" });
  }
  if (store.instagram_url.trim() !== "") {
    urls.push({
      url: store.instagram_url.trim(),
      title: "公式Instagram(登録情報)",
      source_type: "official_sns",
    });
  }
  return urls;
}
