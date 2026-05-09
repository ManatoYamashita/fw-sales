/**
 * validateAiAnalysis のテスト。
 *
 * 関連: design.md §「Validator」, requirements.md §3.5, §7.3
 */
import { describe, expect, it } from "vitest";
import { validateAiAnalysis } from "../validate";

const validRaw = {
  strengths_markdown: "## 強み\n- 立地が良い",
  weaknesses_markdown: "## 弱み\n- 客単価が低い",
  gourmet_paid_status: "食べログ無料プラン",
  gbp_completeness: "説明欄あり",
  call_script: "テスト架電スクリプト",
  confidence: {
    strengths: 80,
    weaknesses: 70,
    gourmet_paid_status: 60,
    gbp_completeness: 75,
    call_script: 85,
  },
};

describe("validateAiAnalysis", () => {
  it("正常入力では ok: true で型安全な値を返す", () => {
    const r = validateAiAnalysis(validRaw);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.call_script).toBe("テスト架電スクリプト");
      expect(r.value.confidence.strengths).toBe(80);
    }
  });

  it("フィールド欠落で ok: false + zodIssues に該当 path", () => {
    const broken: Record<string, unknown> = { ...validRaw };
    delete broken.weaknesses_markdown;
    const r = validateAiAnalysis(broken);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("schema_violation");
      const joined = r.error.zodIssues.join("|");
      expect(joined).toMatch(/weaknesses_markdown/);
    }
  });

  it.each([-1, 101, 73.5])(
    "confidence 範囲外 / 非整数 %d で ok: false",
    (bad) => {
      const broken = {
        ...validRaw,
        confidence: { ...validRaw.confidence, strengths: bad },
      };
      const r = validateAiAnalysis(broken);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.zodIssues.join("|")).toMatch(/confidence|strengths/);
      }
    },
  );

  it("call_script 1501 字で ok: false (Req 3.3)", () => {
    const broken = {
      ...validRaw,
      call_script: "あ".repeat(1501),
    };
    const r = validateAiAnalysis(broken);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.zodIssues.join("|")).toMatch(/call_script/);
    }
  });

  it("追加プロパティで ok: false (.strict)", () => {
    const broken = { ...validRaw, extra: "uninvited" };
    const r = validateAiAnalysis(broken);
    expect(r.ok).toBe(false);
  });

  it("非オブジェクト入力 (string) で ok: false", () => {
    const r = validateAiAnalysis("invalid");
    expect(r.ok).toBe(false);
  });

  it("zodIssues は path: message 形式", () => {
    const r = validateAiAnalysis({ unknown: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.zodIssues.length).toBeGreaterThan(0);
      // path: message の形(":" 区切り)
      expect(r.error.zodIssues[0]).toMatch(/.*:.*/);
    }
  });
});
