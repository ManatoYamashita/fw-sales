/**
 * Stage 1 の Google Search grounding metadata から Source Registry を構築する。
 * AI 店舗調査再設計(Plan v3.2 §8「Source Registry構築ルール」、PR2)。
 *
 * 手順:
 * 1. `groundingMetadata.groundingChunks[]`(公式フィールド)を基準リストとする。
 *    各要素の `uri`(grounding redirect URL)・`title` を Source of Truth として
 *    Source Registry エントリの初期値にする。
 * 2. モデルが自由記述で出力した `[SOURCE]` ブロック(url/title/type/why_useful)を、
 *    `url` が groundingChunks の `uri` と**完全一致**する場合のみ、`type` を
 *    enrichment として採用する。一致しないブロックは無視する(新規エントリを
 *    作らない = モデルの自由生成URLをSource Registryへ自動登録しない)。
 * 3. groundingChunks出現順に `S01`, `S02`, ... と連番IDを付与する。
 * 4. `discovery_provenance` は全エントリ固定で `"google_grounding"`。
 *
 * `resolved_url` / `resolve_status`(Stage 1.5)・`url_context_status`(Stage2)は
 * この時点では未確定のため、それぞれ `null`/`"skipped"`・`"not_attempted"` で
 * 初期化する。
 */

import type { SourceRegistryEntry, SourceType } from "@/lib/ai/research-result-schema";
import { SOURCE_TYPES } from "@/lib/ai/research-result-schema";

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

function toSourceType(raw: string): SourceType {
  return (SOURCE_TYPES as readonly string[]).includes(raw) ? (raw as SourceType) : "other";
}

/**
 * Stage1 の grounding metadata + モデル自由記述テキストから Source Registry を構築する。
 *
 * @param groundingMetadata Stage1 API レスポンスの `candidate.groundingMetadata`
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

  const enrichmentByUrl = new Map<string, ParsedSourceBlock>();
  for (const block of parseSourceBlocks(modelFreeText)) {
    if (!enrichmentByUrl.has(block.url)) {
      enrichmentByUrl.set(block.url, block);
    }
  }

  return chunks.map((chunk, index) => {
    const enrichment = enrichmentByUrl.get(chunk.web.uri);
    const id = `S${String(index + 1).padStart(2, "0")}`;

    const entry: SourceRegistryEntry = {
      id,
      title: enrichment?.title || chunk.web.title || chunk.web.uri,
      grounding_redirect_url: chunk.web.uri,
      resolved_url: null,
      resolve_status: "skipped",
      source_type: enrichment ? toSourceType(enrichment.type) : "other",
      discovery_provenance: "google_grounding",
      url_context_status: "not_attempted",
    };
    return entry;
  });
}
