/**
 * `DeepResearchItemSchema` / `DeepResearchReportSchema` の単体テスト
 * (deep-research-pipeline spec, Issue #43, Task 2.3)
 *
 * カバレッジ (6 ケース):
 * 1. tier=A: value のみで通過
 * 2. tier=B: confidence/source_urls/source_quote 欠落で schema_violation
 * 3. tier=B: 全部揃って通過
 * 4. tier=C: hearing_question 欠落で schema_violation
 * 5. tier=C: hearing_question 付きで通過 (value=null も許容)
 * 6. getDeepResearchJsonSchema: Gemini 非対応 key が除去され propertyOrdering が付く
 *
 * 関連: requirements.md §3.2, §3.3, §3.4, §3.5
 */

import { describe, expect, it } from "vitest";
import {
  DeepResearchItemSchema,
  DEEP_RESEARCH_ITEMS_FLAT,
  TOTAL_ITEM_COUNT,
  getDeepResearchJsonSchema,
} from "../schema";

describe("DeepResearchItemSchema", () => {
  it("tier=A: value のみで通過", () => {
    const result = DeepResearchItemSchema.safeParse({
      key: "store_name",
      label: "屋号",
      tier: "A",
      value: "テスト食堂",
    });
    expect(result.success).toBe(true);
  });

  it("tier=B: confidence/source_urls/source_quote 欠落で schema_violation", () => {
    const result = DeepResearchItemSchema.safeParse({
      key: "average_spend_day_night",
      label: "客単価",
      tier: "B",
      value: "1500-3000 円",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("confidence");
      expect(paths).toContain("source_urls");
      expect(paths).toContain("source_quote");
    }
  });

  it("tier=B: 全部揃って通過", () => {
    const result = DeepResearchItemSchema.safeParse({
      key: "seat_count",
      label: "席数",
      tier: "B",
      value: "20 席程度",
      confidence: 70,
      source_urls: ["https://tabelog.example.com/store/12345/"],
      source_quote: "席数: 約 20 席",
    });
    expect(result.success).toBe(true);
  });

  it("tier=C: hearing_question 欠落で schema_violation", () => {
    const result = DeepResearchItemSchema.safeParse({
      key: "revenue",
      label: "売上高",
      tier: "C",
      value: null,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("hearing_question");
    }
  });

  it("tier=C: hearing_question 付き + value=null で通過", () => {
    const result = DeepResearchItemSchema.safeParse({
      key: "revenue",
      label: "売上高",
      tier: "C",
      value: null,
      hearing_question: "月商の概算をお聞かせください。",
    });
    expect(result.success).toBe(true);
  });
});

describe("getDeepResearchJsonSchema", () => {
  it("Gemini 非対応 key が除去され、propertyOrdering が付く", () => {
    const schema = getDeepResearchJsonSchema();
    const json = JSON.stringify(schema);

    // 非対応 key が一切含まれないこと
    expect(json).not.toContain('"$schema"');
    expect(json).not.toContain('"maxLength"');
    expect(json).not.toContain('"minLength"');
    expect(json).not.toContain('"pattern"');
    expect(json).not.toContain('"default"');

    // propertyOrdering が埋め込まれていること
    expect(Array.isArray(schema.propertyOrdering)).toBe(true);
    const ordering = schema.propertyOrdering as string[];
    expect(ordering[0]).toBe("category_1_basic");
    expect(ordering).toContain("hearing_questions");
    expect(ordering).toContain("full_markdown");
  });
});

describe("DEEP_RESEARCH_ITEMS", () => {
  it("カテゴリと項目キーが定義されており、TOTAL_ITEM_COUNT は 50 件以上", () => {
    expect(TOTAL_ITEM_COUNT).toBeGreaterThanOrEqual(50);
    // 各項目のキーが unique であること
    const keys = DEEP_RESEARCH_ITEMS_FLAT.map((i) => i.key);
    const uniqueKeys = new Set(keys);
    expect(uniqueKeys.size).toBe(keys.length);
  });
});
