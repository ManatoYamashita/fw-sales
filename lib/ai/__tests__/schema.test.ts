/**
 * AiAnalysisSchema の妥当性 + JSON Schema 変換のテスト。
 *
 * 関連: design.md §「AiAnalysisSchema」, requirements.md §3.1, §3.2, §3.3
 */
import { describe, expect, it } from "vitest";
import {
  AI_ANALYSIS_PROPERTY_ORDERING,
  AiAnalysisSchema,
  CONFIDENCE_FIELDS,
  getAiAnalysisJsonSchema,
} from "../schema";

const validResult = {
  strengths_markdown: "## 強み\n- 立地が良い",
  weaknesses_markdown: "## 弱み\n- 客単価が低い",
  gourmet_paid_status: "食べログ無料プラン",
  gbp_completeness: "説明欄あり / 口コミ返信なし / メニューあり",
  call_script: "ご準備中にすみません、私ファーストWEBの渡部と申します",
  confidence: {
    strengths: 80,
    weaknesses: 70,
    gourmet_paid_status: 60,
    gbp_completeness: 75,
    call_script: 85,
  },
};

describe("AiAnalysisSchema", () => {
  it("正常入力は parse 成功する", () => {
    const result = AiAnalysisSchema.safeParse(validResult);
    expect(result.success).toBe(true);
  });

  it("strengths_markdown 欠落で fail (Req 3.1)", () => {
    const broken: Record<string, unknown> = { ...validResult };
    delete broken.strengths_markdown;
    expect(AiAnalysisSchema.safeParse(broken).success).toBe(false);
  });

  it("confidence サブフィールド (call_script) 欠落で fail (Req 3.2)", () => {
    const broken = {
      ...validResult,
      confidence: { ...validResult.confidence, call_script: undefined },
    };
    delete (broken.confidence as Record<string, unknown>).call_script;
    expect(AiAnalysisSchema.safeParse(broken).success).toBe(false);
  });

  it.each([-1, 101, 73.5])(
    "confidence 範囲外 / 非整数 %d で fail (Req 3.2)",
    (bad) => {
      const broken = {
        ...validResult,
        confidence: { ...validResult.confidence, strengths: bad },
      };
      expect(AiAnalysisSchema.safeParse(broken).success).toBe(false);
    },
  );

  it("call_script 1501 字で fail (Req 3.3)", () => {
    const broken = {
      ...validResult,
      call_script: "あ".repeat(1501),
    };
    expect(AiAnalysisSchema.safeParse(broken).success).toBe(false);
  });

  it("call_script 1500 字ちょうどなら成功 (Req 3.3 境界値)", () => {
    const valid = {
      ...validResult,
      call_script: "あ".repeat(1500),
    };
    expect(AiAnalysisSchema.safeParse(valid).success).toBe(true);
  });

  it("追加プロパティで fail (.strict、Req 3.5)", () => {
    const broken = { ...validResult, extra: "should not be here" };
    expect(AiAnalysisSchema.safeParse(broken).success).toBe(false);
  });

  it("CONFIDENCE_FIELDS は 5 個の expected キーを含む", () => {
    expect(CONFIDENCE_FIELDS).toEqual([
      "strengths",
      "weaknesses",
      "gourmet_paid_status",
      "gbp_completeness",
      "call_script",
    ]);
  });
});

describe("getAiAnalysisJsonSchema", () => {
  it("propertyOrdering が 6 フィールドの順序で含まれる", () => {
    const schema = getAiAnalysisJsonSchema();
    expect(schema.propertyOrdering).toEqual([
      "strengths_markdown",
      "weaknesses_markdown",
      "gourmet_paid_status",
      "gbp_completeness",
      "call_script",
      "confidence",
    ]);
  });

  it("AI_ANALYSIS_PROPERTY_ORDERING と propertyOrdering は同じ順序", () => {
    const schema = getAiAnalysisJsonSchema();
    expect(schema.propertyOrdering).toEqual([
      ...AI_ANALYSIS_PROPERTY_ORDERING,
    ]);
  });

  it("type: object で properties に 6 フィールドが揃う", () => {
    const schema = getAiAnalysisJsonSchema();
    expect(schema.type).toBe("object");
    const properties = schema.properties as Record<string, unknown>;
    expect(Object.keys(properties)).toEqual(
      expect.arrayContaining([
        "strengths_markdown",
        "weaknesses_markdown",
        "gourmet_paid_status",
        "gbp_completeness",
        "call_script",
        "confidence",
      ]),
    );
  });
});
