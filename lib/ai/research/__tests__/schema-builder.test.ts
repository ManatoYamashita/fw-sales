/**
 * 動的 JSON Schema / Zod スキーマ生成の単体検証(AI 店舗調査再設計 Plan v3.2 §10, PR2)。
 */

import { describe, it, expect } from "vitest";
import { buildStage2JsonSchema, buildStage2ResponseZodSchema } from "../schema-builder";

/** JSON Schema はネストしたプレーンオブジェクトのため、テストでは緩い型で辿る。 */
type JsonSchemaNode = Record<string, unknown>;

function getItemSchema(schema: JsonSchemaNode): JsonSchemaNode {
  const properties = schema.properties as JsonSchemaNode;
  const itemsField = properties.items as JsonSchemaNode;
  return itemsField.items as JsonSchemaNode;
}

describe("buildStage2JsonSchema", () => {
  it("key.enumがallowedKeysに制限される", () => {
    const schema = buildStage2JsonSchema({
      allowedKeys: ["business_hours_holidays", "seat_count"],
      registryIds: ["S01"],
    });
    const itemSchema = getItemSchema(schema);
    const itemProperties = itemSchema.properties as JsonSchemaNode;
    const keyField = itemProperties.key as JsonSchemaNode;
    expect(keyField.enum).toEqual(["business_hours_holidays", "seat_count"]);
  });

  it("source_ids.items.enumがregistryIdsに制限される", () => {
    const schema = buildStage2JsonSchema({
      allowedKeys: ["seat_count"],
      registryIds: ["S01", "S02", "S03"],
    });
    const itemSchema = getItemSchema(schema);
    const itemProperties = itemSchema.properties as JsonSchemaNode;
    const sourceIds = itemProperties.source_ids as JsonSchemaNode;
    const sourceIdItems = sourceIds.items as JsonSchemaNode;
    expect(sourceIdItems.enum).toEqual(["S01", "S02", "S03"]);
  });

  it("candidates内のsource_idsもregistryIdsに制限される", () => {
    const schema = buildStage2JsonSchema({
      allowedKeys: ["business_hours_holidays"],
      registryIds: ["S01"],
    });
    const itemSchema = getItemSchema(schema);
    const itemProperties = itemSchema.properties as JsonSchemaNode;
    const candidatesField = itemProperties.candidates as JsonSchemaNode;
    const anyOf = candidatesField.anyOf as JsonSchemaNode[] | undefined;
    const candidatesArraySchema = (anyOf?.[0] ?? candidatesField) as JsonSchemaNode;
    const candidateItemSchema = candidatesArraySchema.items as JsonSchemaNode;
    const candidateProperties = candidateItemSchema.properties as JsonSchemaNode;
    const candidateSourceIds = candidateProperties.source_ids as JsonSchemaNode;
    const candidateSourceIdItems = candidateSourceIds.items as JsonSchemaNode;
    expect(candidateSourceIdItems.enum).toEqual(["S01"]);
  });

  it("propertyOrderingがトップレベルと項目レベルに設定される", () => {
    const schema = buildStage2JsonSchema({ allowedKeys: ["x"], registryIds: ["S01"] });
    expect(schema.propertyOrdering).toEqual(["store_identification", "source_verifications", "items"]);
    const itemSchema = getItemSchema(schema);
    expect(itemSchema.propertyOrdering).toContain("key");
    expect(itemSchema.propertyOrdering).toContain("source_ids");
  });

  it("source_verifications.items.propertyOrderingが設定される(fix/ai-research-source-identity-integrity)", () => {
    const schema = buildStage2JsonSchema({ allowedKeys: ["x"], registryIds: ["S01"] });
    const properties = schema.properties as JsonSchemaNode;
    const verificationsField = properties.source_verifications as JsonSchemaNode;
    const verificationItemSchema = verificationsField.items as JsonSchemaNode;
    expect(verificationItemSchema.propertyOrdering).toContain("source_id");
    expect(verificationItemSchema.propertyOrdering).toContain("relation");
  });

  it("source_verifications[].source_id.enumがregistryIdsに制限される(fix/ai-research-source-identity-integrity)", () => {
    const schema = buildStage2JsonSchema({ allowedKeys: ["x"], registryIds: ["S01", "S02"] });
    const properties = schema.properties as JsonSchemaNode;
    const verificationsField = properties.source_verifications as JsonSchemaNode;
    const verificationItemSchema = verificationsField.items as JsonSchemaNode;
    const verificationProperties = verificationItemSchema.properties as JsonSchemaNode;
    const sourceIdField = verificationProperties.source_id as JsonSchemaNode;
    expect(sourceIdField.enum).toEqual(["S01", "S02"]);
  });

  it("Gemini非対応キー($schema等)を含まない", () => {
    const schema = buildStage2JsonSchema({ allowedKeys: ["x"], registryIds: ["S01"] });
    expect(JSON.stringify(schema)).not.toContain("$schema");
  });

  it("registryIdsが空配列でも例外を投げない (安全なフォールバック)", () => {
    expect(() =>
      buildStage2JsonSchema({ allowedKeys: ["x"], registryIds: [] }),
    ).not.toThrow();
  });

  it("allowedKeysが空配列でも例外を投げない", () => {
    expect(() =>
      buildStage2JsonSchema({ allowedKeys: [], registryIds: ["S01"] }),
    ).not.toThrow();
  });
});

describe("buildStage2ResponseZodSchema", () => {
  it("registryIdsに含まれるsource_idを受理する", () => {
    const schema = buildStage2ResponseZodSchema(["business_hours_holidays"], ["S01"]);
    const result = schema.safeParse({
      store_identification: { matched_name: "x", matched_address: "y", identification_note: "z" },
      source_verifications: [
        {
          source_id: "S01",
          relation: "target_store",
          observed_title: "t",
          observed_name: "n",
          observed_address: "a",
          observed_phone: "p",
          note: "note",
        },
      ],
      items: [
        {
          key: "business_hours_holidays",
          research_policy: "FACT",
          status: "confirmed",
          value: "17:00-24:00",
          evidence: "e",
          source_ids: ["S01"],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("registryIdsに含まれないsource_idを拒否する", () => {
    const schema = buildStage2ResponseZodSchema(["business_hours_holidays"], ["S01"]);
    const result = schema.safeParse({
      store_identification: { matched_name: "x", matched_address: "y", identification_note: "z" },
      source_verifications: [],
      items: [
        {
          key: "business_hours_holidays",
          research_policy: "FACT",
          status: "confirmed",
          value: "17:00-24:00",
          evidence: "e",
          source_ids: ["S99"],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("allowedKeysに含まれないkeyを拒否する", () => {
    const schema = buildStage2ResponseZodSchema(["business_hours_holidays"], ["S01"]);
    const result = schema.safeParse({
      store_identification: { matched_name: "x", matched_address: "y", identification_note: "z" },
      source_verifications: [],
      items: [
        {
          key: "revenue", // allowedKeysに含まれない
          research_policy: "HEARING_ONLY",
          status: "hearing_required",
          value: null,
          evidence: "",
          source_ids: [],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("registryIdsに含まれないsource_verifications[].source_idを拒否する(fix/ai-research-source-identity-integrity)", () => {
    const schema = buildStage2ResponseZodSchema(["business_hours_holidays"], ["S01"]);
    const result = schema.safeParse({
      store_identification: { matched_name: "x", matched_address: "y", identification_note: "z" },
      source_verifications: [
        {
          source_id: "S99",
          relation: "target_store",
          observed_title: null,
          observed_name: null,
          observed_address: null,
          observed_phone: null,
          note: "",
        },
      ],
      items: [],
    });
    expect(result.success).toBe(false);
  });

  it("未知のsource_verifications[].relationを拒否する(fix/ai-research-source-identity-integrity)", () => {
    const schema = buildStage2ResponseZodSchema(["business_hours_holidays"], ["S01"]);
    const result = schema.safeParse({
      store_identification: { matched_name: "x", matched_address: "y", identification_note: "z" },
      source_verifications: [
        {
          source_id: "S01",
          relation: "official_partner", // 未知のrelation
          observed_title: null,
          observed_name: null,
          observed_address: null,
          observed_phone: null,
          note: "",
        },
      ],
      items: [],
    });
    expect(result.success).toBe(false);
  });
});

/**
 * `evidence_basis` 非公開の不変条件
 * (feat/ai-research-quality-ux-hardening、Plan §7.1.1 / 承認レビュー指摘1)。
 *
 * canonical fallback bypass は
 * 「key ∈ canonicalVerifiedKeys AND evidence_basis === "existing_canonical"」を
 * 発火条件にしている。この AND が防御として機能するのは、
 * **Stage2 Structured Output schema が `evidence_basis` をモデルへ公開していない**
 * ため AI 生成 item の `evidence_basis` が構造的に必ず `undefined` になる、という
 * 一点に依存する。将来 schema に `evidence_basis` を足すとこの防御が無効化されるため、
 * ここで明示的に固定する。
 */
describe("evidence_basis を Stage2 schema へ公開しない (canonical bypass の二重防御)", () => {
  it("items要素のpropertiesに evidence_basis が存在しない", () => {
    const schema = buildStage2JsonSchema({
      allowedKeys: ["official_site", "review_avg"],
      registryIds: ["S01"],
    });
    const itemProperties = getItemSchema(schema).properties as JsonSchemaNode;
    expect(Object.keys(itemProperties)).not.toContain("evidence_basis");
  });

  it("JSON Schema 全文に evidence_basis という文字列が現れない", () => {
    const schema = buildStage2JsonSchema({
      allowedKeys: ["official_site"],
      registryIds: ["S01"],
    });
    expect(JSON.stringify(schema)).not.toContain("evidence_basis");
  });

  it("Zod側も evidence_basis を受け付けない(モデルが勝手に返しても取り込まれない)", () => {
    const zodSchema = buildStage2ResponseZodSchema(["official_site"], ["S01"]);
    const parsed = zodSchema.safeParse({
      store_identification: {
        matched_name: "炉端ジュン",
        matched_address: "東京都渋谷区1-2-3",
        identification_note: "",
      },
      source_verifications: [],
      items: [
        {
          key: "official_site",
          research_policy: "FACT",
          status: "confirmed",
          value: "あり (https://example.test/)",
          evidence: "公式サイトに明記",
          source_ids: ["S01"],
          evidence_basis: "existing_canonical",
        },
      ],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const item = parsed.data.items[0] as Record<string, unknown>;
      expect(item.evidence_basis).toBeUndefined();
    }
  });
});
