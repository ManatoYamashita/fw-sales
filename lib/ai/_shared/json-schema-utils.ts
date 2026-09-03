/**
 * Gemini API に渡す JSON Schema を扱うための共通ユーティリティ。
 *
 * 用途:
 * - 既存同期 AI 分析 (`lib/ai/schema.ts:getAiAnalysisJsonSchema`)
 * - AI 店舗調査の応答スキーマ生成 (`lib/ai/research/schema-builder.ts`)
 *   の両者から参照される。
 *   (初出の消費者だった Deep Research Stage 2 構造化は #121/#125 で撤去済み。
 *    本ファイルは上記 2 つの現役消費者を持つため撤去対象ではない。)
 *
 * 設計上のポイント:
 * - Gemini API は JSON Schema の **subset** しか受理せず、`$schema` / `maxLength`
 *   等の非対応キーを含めると 400 (INVALID_ARGUMENT) を返す。
 *   `stripUnsupportedKeys()` で再帰的に除去する。
 * - 生成 JSON のフィールド順は `propertyOrdering` を明示しないとぶれる。
 *   `withPropertyOrdering()` で順序を埋め込む。
 *
 * 関連: design.md §Architecture / Key Decisions, research.md §Design Synthesis
 *       (Generalization), lib/ai/client.ts:6-9 の constraint コメント
 */

/**
 * Gemini API がサポートしないプロパティ。`responseJsonSchema` で 400 を返す原因になる。
 * 公式ドキュメント上の allow list に含まれないものを再帰除去する。
 *
 * 参照: node_modules/@google/genai/dist/genai.d.ts L4551-L4565
 *   サポート: $id, $defs, $ref, $anchor, type, format, title, description,
 *            enum, items, prefixItems, minItems, maxItems, minimum, maximum,
 *            anyOf, oneOf, properties, additionalProperties, required, propertyOrdering
 */
const GEMINI_UNSUPPORTED_KEYS = new Set([
  "$schema",
  "minLength",
  "maxLength",
  "pattern",
  "multipleOf",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "default",
]);

/**
 * JSON Schema 内の Gemini 非対応 key を再帰除去する。
 *
 * 呼出側はクライアント側 (Zod `safeParse` 等) で再検証する前提。API 側の
 * schema 強制は補助的扱い (Req 3.5、research.md Decision 3 / Synthesis Generalization)。
 */
export function stripUnsupportedKeys(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(stripUnsupportedKeys);
  }
  if (node === null || typeof node !== "object") {
    return node;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (GEMINI_UNSUPPORTED_KEYS.has(k)) continue;
    out[k] = stripUnsupportedKeys(v);
  }
  return out;
}

/**
 * JSON Schema オブジェクトのトップレベルに `propertyOrdering` を埋め込んで返す。
 *
 * 元 schema は破壊しない (シャローコピーして新規オブジェクトを返す)。
 */
export function withPropertyOrdering(
  schema: Record<string, unknown>,
  ordering: readonly string[],
): Record<string, unknown> {
  return {
    ...schema,
    propertyOrdering: [...ordering],
  };
}
