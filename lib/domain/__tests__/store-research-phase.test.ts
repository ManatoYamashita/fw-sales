import { describe, it, expect } from "vitest";
import type { BasicInfoField, FillSource } from "@/types/basic-info";
import {
  RESEARCH_PHASE_META,
  getStoreResearchPhase,
  isBasicInfoFieldFilled,
  salesAssetsHref,
  type ResearchPhase,
} from "../store-research-phase";

function field(
  value: string | null,
  filled_by: FillSource | null,
): BasicInfoField {
  return { value, tier: "A", filled_by, updated_at: "2026-06-13T00:00:00.000Z" };
}

describe("isBasicInfoFieldFilled", () => {
  it("filled_by が付き value が非空白なら充填済み", () => {
    expect(isBasicInfoFieldFilled(field("渋谷区", "places"))).toBe(true);
    expect(isBasicInfoFieldFilled(field("手入力", "manual"))).toBe(true);
  });
  it("filled_by が null / value 空白 / undefined は未充足", () => {
    expect(isBasicInfoFieldFilled(field("値", null))).toBe(false);
    expect(isBasicInfoFieldFilled(field("", "places"))).toBe(false);
    expect(isBasicInfoFieldFilled(field("   ", "places"))).toBe(false);
    expect(isBasicInfoFieldFilled(field(null, "places"))).toBe(false);
    expect(isBasicInfoFieldFilled(undefined)).toBe(false);
  });
});

describe("getStoreResearchPhase", () => {
  it("ai_analysis_result があれば generated", () => {
    const phase = getStoreResearchPhase({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ai_analysis_result: { call_script: "x" } as any,
    });
    expect(phase).toBe<ResearchPhase>("generated");
  });

  it("ai_analysis_result が無ければ pending (基本情報の充足には依らない、#300)", () => {
    expect(getStoreResearchPhase({ ai_analysis_result: null })).toBe<ResearchPhase>(
      "pending",
    );
  });
});

describe("RESEARCH_PHASE_META", () => {
  const phases: ResearchPhase[] = ["pending", "generated"];

  it("全状態に badge と CTA が定義されている", () => {
    for (const phase of phases) {
      const meta = RESEARCH_PHASE_META[phase];
      expect(meta.badgeLabel).toBeTruthy();
      expect(meta.cta.label).toBeTruthy();
    }
  });

  it("バッジは「営業資産」の状態だと読めるラベルを持つ (調査の状態と混同させない、#300)", () => {
    for (const phase of phases) {
      expect(RESEARCH_PHASE_META[phase].badgeLabel).toContain("営業資産");
    }
  });

  it("CTA はすべて唯一の入口 /research/[storeId] へ遷移する (#300)", () => {
    for (const phase of phases) {
      expect(RESEARCH_PHASE_META[phase].cta.href("store-1")).toMatch(
        /^\/research\/store-1(#|$)/,
      );
    }
  });

  it("生成済みの CTA は生成セクションへ着地する", () => {
    expect(RESEARCH_PHASE_META.generated.cta.href("store-1")).toBe(
      salesAssetsHref("store-1"),
    );
    expect(salesAssetsHref("store-1")).toBe("/research/store-1#sales-assets");
  });
});
