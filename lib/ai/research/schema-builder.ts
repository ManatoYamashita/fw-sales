/**
 * Stage2 (FACT / ANALYSIS) の Structured Output 用スキーマを動的に生成する。
 * AI 店舗調査再設計(Plan v3.2 §10「動的スキーマ生成」、PR2)。
 *
 * `source_ids` の enum をその run の Source Registry ID 一覧へ、`key` の enum を
 * そのステージが担当する項目キー一覧へ、それぞれ動的制限する。これにより
 * モデルが架空の source や、そのステージが担当しない項目キーを出力できなくする。
 *
 * 重要: この enum 制限は**あくまで一次防御**であり、`lib/ai/research-result-schema.ts`
 * の `applyDeterministicValidation`(`sanitizeSourceIds` / `enforceResearchPolicy` 等)
 * による実行時の再検証が最終防御となる(Plan v3.2 PR1 fresh review C)。API 側の
 * schema 強制が効かないケース(モデルの逸脱、SDKの解釈違い等)があっても安全側に倒れる。
 */

import { z } from "zod";
import {
  stripUnsupportedKeys,
  withPropertyOrdering,
} from "@/lib/ai/_shared/json-schema-utils";
import {
  ResearchPolicySchema,
  RESEARCH_STATUSES,
  SOURCE_VERIFICATION_RELATIONS,
} from "@/lib/ai/research-result-schema";

const TOP_LEVEL_PROPERTY_ORDERING = ["store_identification", "source_verifications", "items"] as const;
const ITEM_PROPERTY_ORDERING = [
  "key",
  "research_policy",
  "status",
  "value",
  "evidence",
  "source_ids",
  "confidence",
  "warning",
  "candidates",
] as const;
const SOURCE_VERIFICATION_PROPERTY_ORDERING = [
  "source_id",
  "relation",
  "observed_title",
  "observed_name",
  "observed_address",
  "observed_phone",
  "note",
] as const;

/**
 * 非空配列を要求する `z.enum` に、空配列を渡された場合の安全なフォールバックを与える。
 * (Source Registry が空、またはステージ対象キーが0件の異常系での保険。
 * この場合でも実際の防御は `applyDeterministicValidation` 側が担う。)
 */
function enumOrString(values: readonly string[]): z.ZodTypeAny {
  return values.length > 0 ? z.enum(values as [string, ...string[]]) : z.string();
}

function buildDynamicResearchItemSchema(
  allowedKeys: readonly string[],
  registryIds: readonly string[],
) {
  const sourceIdSchema = z.array(enumOrString(registryIds));

  const candidateSchema = z.object({
    candidate_id: z.string(),
    label: z.string(),
    value: z.string(),
    evidence: z.string(),
    source_ids: sourceIdSchema,
  });

  return z.object({
    key: enumOrString(allowedKeys),
    research_policy: ResearchPolicySchema,
    status: z.enum(RESEARCH_STATUSES),
    value: z.string().nullable(),
    evidence: z.string(),
    source_ids: sourceIdSchema,
    confidence: z.number().min(0).max(100).nullable().optional(),
    warning: z.string().nullable().optional(),
    candidates: z.array(candidateSchema).nullable().optional(),
  });
}

/**
 * per-source identity verification(fix/ai-research-source-identity-integrity)。
 * `source_id`をSource Registryのid一覧へ動的制限する(捏造・未知IDの拒否、既存の
 * `source_ids.items.enum`と同じ一次防御)。`registryIds`が空の場合の安全な
 * フォールバックも既存の`enumOrString`をそのまま再利用する。
 */
function buildSourceVerificationSchema(registryIds: readonly string[]) {
  return z.object({
    source_id: enumOrString(registryIds),
    relation: z.enum(SOURCE_VERIFICATION_RELATIONS),
    observed_title: z.string().nullable(),
    observed_name: z.string().nullable(),
    observed_address: z.string().nullable(),
    observed_phone: z.string().nullable(),
    note: z.string(),
  });
}

function buildDynamicStage2ResponseSchema(
  allowedKeys: readonly string[],
  registryIds: readonly string[],
) {
  return z.object({
    store_identification: z.object({
      matched_name: z.string(),
      matched_address: z.string(),
      identification_note: z.string(),
    }),
    // fix/ai-research-source-identity-integrity: Source Registryの各source_idについて
    // 「実際に取得したページが対象店舗/競合/文脈情報/無関係のいずれか」をモデル自身に
    // 申告させる。既存Stage2 Structured Outputへ追加するため、追加のGemini呼出は
    // 発生しない(Gemini呼出はrunあたりStage1 1回・Stage2 1回のまま)。
    source_verifications: z.array(buildSourceVerificationSchema(registryIds)),
    items: z.array(buildDynamicResearchItemSchema(allowedKeys, registryIds)),
  });
}

export interface Stage2SchemaBuildParams {
  /** このステージ(FACT または ANALYSIS)が担当する `ResearchItem.key` 一覧。 */
  allowedKeys: readonly string[];
  /** その run の Source Registry の id 一覧。 */
  registryIds: readonly string[];
}

/**
 * Gemini `responseJsonSchema` に渡す JSON Schema を返す。
 * `key.enum` / `source_ids.items.enum` を動的制限し、`propertyOrdering` を明示する
 * (`lib/ai/schema.ts:getAiAnalysisJsonSchema` と同じ規約)。
 */
export function buildStage2JsonSchema(params: Stage2SchemaBuildParams): Record<string, unknown> {
  const zodSchema = buildDynamicStage2ResponseSchema(params.allowedKeys, params.registryIds);
  const raw = z.toJSONSchema(zodSchema, { target: "draft-2020-12" });
  const stripped = stripUnsupportedKeys(raw) as Record<string, unknown>;
  const withTopOrdering = withPropertyOrdering(stripped, TOP_LEVEL_PROPERTY_ORDERING);
  return withItemPropertyOrdering(withTopOrdering);
}

/**
 * `items.items`(配列要素=1件分のResearchItemスキーマ)・`source_verifications.items`
 * (配列要素=1件分のSourceVerificationスキーマ)にも `propertyOrdering` を埋め込む。
 * `withPropertyOrdering` はトップレベル専用のため、ここでネスト path を直接書き換える。
 */
function withItemPropertyOrdering(schema: Record<string, unknown>): Record<string, unknown> {
  const properties = schema.properties as Record<string, unknown> | undefined;
  const itemsField = properties?.items as Record<string, unknown> | undefined;
  const itemSchema = itemsField?.items as Record<string, unknown> | undefined;
  const verificationsField = properties?.source_verifications as Record<string, unknown> | undefined;
  const verificationSchema = verificationsField?.items as Record<string, unknown> | undefined;

  if (!itemSchema && !verificationSchema) return schema;

  return {
    ...schema,
    properties: {
      ...properties,
      ...(itemSchema
        ? {
            items: {
              ...itemsField,
              items: { ...itemSchema, propertyOrdering: [...ITEM_PROPERTY_ORDERING] },
            },
          }
        : {}),
      ...(verificationSchema
        ? {
            source_verifications: {
              ...verificationsField,
              items: {
                ...verificationSchema,
                propertyOrdering: [...SOURCE_VERIFICATION_PROPERTY_ORDERING],
              },
            },
          }
        : {}),
    },
  };
}

/**
 * Zod スキーマ側(検証用)。`buildStage2JsonSchema` と同じ動的制約(key/source_ids の
 * enum)を持つ。Gemini API 応答を `safeParse` する際にこちらを使う。
 */
export function buildStage2ResponseZodSchema(
  allowedKeys: readonly string[],
  registryIds: readonly string[],
) {
  return buildDynamicStage2ResponseSchema(allowedKeys, registryIds);
}

export type Stage2Response = z.infer<ReturnType<typeof buildDynamicStage2ResponseSchema>>;
