import { describe, it, expect } from "vitest";
import type { BasicInfo, BasicInfoField, FillSource } from "@/types/basic-info";
import {
  CORE_BASIC_INFO_KEYS,
  READY_CORE_THRESHOLD,
  RESEARCH_PHASE_META,
  filledCoreCount,
  getStoreResearchPhase,
  isBasicInfoFieldFilled,
  type ResearchPhase,
} from "../store-research-phase";

function field(
  value: string | null,
  filled_by: FillSource | null,
): BasicInfoField {
  return { value, tier: "A", filled_by, updated_at: "2026-06-13T00:00:00.000Z" };
}

/** 指定キーを places 充填した basic_info を作る。 */
function basicInfoWith(keys: readonly string[]): BasicInfo {
  const info: BasicInfo = {};
  for (const key of keys) info[key] = field("値", "places");
  return info;
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

describe("filledCoreCount", () => {
  it("コアキーの充填数のみ数える (非コアは無視)", () => {
    const info = basicInfoWith([
      CORE_BASIC_INFO_KEYS[0],
      CORE_BASIC_INFO_KEYS[1],
      "store_name", // 非コア
      "concept", // 非コア
    ]);
    expect(filledCoreCount(info)).toBe(2);
  });
  it("空の basic_info は 0", () => {
    expect(filledCoreCount({})).toBe(0);
  });
});

describe("getStoreResearchPhase", () => {
  const noAssets = null;

  it("ai_analysis_result があれば常に generated (basic_info に依らず)", () => {
    const phase = getStoreResearchPhase({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ai_analysis_result: { call_script: "x" } as any,
      basic_info: {},
    });
    expect(phase).toBe<ResearchPhase>("generated");
  });

  it("コア充足が閾値以上なら ready", () => {
    const info = basicInfoWith(
      CORE_BASIC_INFO_KEYS.slice(0, READY_CORE_THRESHOLD),
    );
    expect(
      getStoreResearchPhase({ ai_analysis_result: noAssets, basic_info: info }),
    ).toBe<ResearchPhase>("ready");
  });

  it("コア充足が閾値未満なら untouched", () => {
    const info = basicInfoWith(
      CORE_BASIC_INFO_KEYS.slice(0, READY_CORE_THRESHOLD - 1),
    );
    expect(
      getStoreResearchPhase({ ai_analysis_result: noAssets, basic_info: info }),
    ).toBe<ResearchPhase>("untouched");
  });

  it("基本情報が空なら untouched", () => {
    expect(
      getStoreResearchPhase({ ai_analysis_result: noAssets, basic_info: {} }),
    ).toBe<ResearchPhase>("untouched");
  });
});

describe("RESEARCH_PHASE_META", () => {
  it("全 3 状態に badge と CTA(遷移先)が定義されている", () => {
    const phases: ResearchPhase[] = ["untouched", "ready", "generated"];
    for (const phase of phases) {
      const meta = RESEARCH_PHASE_META[phase];
      expect(meta.badgeLabel).toBeTruthy();
      expect(meta.cta.label).toBeTruthy();
      expect(meta.cta.href("store-1")).toContain("store-1");
    }
  });
});
