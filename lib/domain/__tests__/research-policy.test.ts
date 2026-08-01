/**
 * research_policy 定義表の単体検証(AI 店舗調査再設計 Plan v3.2 §7, PR1)
 *
 * `RESEARCH_POLICY_ITEMS` が `BASIC_INFO_ITEMS` と完全なkey集合一致を持つこと、
 * および Plan v3.2 §7 の集計(FACT=20 / ANALYSIS=17 / FACT_OR_HEARING=5 /
 * HEARING_ONLY=10 / EXTERNAL_DATA_REQUIRED=1、合計53)を検証する。
 */

import { describe, it, expect } from "vitest";
import {
  RESEARCH_POLICY_ITEMS,
  RESEARCH_POLICIES,
  getResearchPolicy,
} from "../research-policy";
import { BASIC_INFO_ITEMS } from "../basic-info-items";

describe("RESEARCH_POLICY_ITEMS", () => {
  it("53項目である", () => {
    expect(RESEARCH_POLICY_ITEMS.length).toBe(53);
  });

  it("BASIC_INFO_ITEMS と key 集合が完全一致する", () => {
    const basicInfoKeys = new Set(BASIC_INFO_ITEMS.map((item) => item.key));
    const policyKeys = new Set(RESEARCH_POLICY_ITEMS.map((item) => item.key));

    expect(policyKeys.size).toBe(basicInfoKeys.size);
    for (const key of basicInfoKeys) {
      expect(policyKeys.has(key)).toBe(true);
    }
    for (const key of policyKeys) {
      expect(basicInfoKeys.has(key)).toBe(true);
    }
  });

  it("key の重複が無い", () => {
    const keys = RESEARCH_POLICY_ITEMS.map((item) => item.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("すべての research_policy が定義済みの5値のいずれかである", () => {
    for (const item of RESEARCH_POLICY_ITEMS) {
      expect(RESEARCH_POLICIES).toContain(item.research_policy);
    }
  });

  it("項目単位の実カウントと一致する (FACT=19 / ANALYSIS=18 / FACT_OR_HEARING=5 / HEARING_ONLY=10 / EXTERNAL_DATA_REQUIRED=1)", () => {
    // 注: Plan v3.2 §7 の要約行は「FACT=20 / ANALYSIS=17」と記載しているが、
    // 同章の53項目一覧表(1項目ずつの割当)を実カウントすると FACT=19 /
    // ANALYSIS=18 が正しい(location_feature 等、v3反映時の再割当で要約行の
    // 更新が漏れたと判断)。本テストは一覧表(Source of Truth)側の実カウントを
    // 正として検証する。要約行の訂正は別途 Plan ファイル側で行う。
    const counts: Record<string, number> = {};
    for (const item of RESEARCH_POLICY_ITEMS) {
      counts[item.research_policy] = (counts[item.research_policy] ?? 0) + 1;
    }

    expect(counts.FACT).toBe(19);
    expect(counts.ANALYSIS).toBe(18);
    expect(counts.FACT_OR_HEARING).toBe(5);
    expect(counts.HEARING_ONLY).toBe(10);
    expect(counts.EXTERNAL_DATA_REQUIRED).toBe(1);

    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
    expect(total).toBe(53);
  });

  it("search_volume は EXTERNAL_DATA_REQUIRED である (⚠PoC問題対応、Plan §7)", () => {
    expect(getResearchPolicy("search_volume")).toBe("EXTERNAL_DATA_REQUIRED");
  });

  it("top_priority_issue は HEARING_ONLY である (⚠PoC問題(4)対応)", () => {
    expect(getResearchPolicy("top_priority_issue")).toBe("HEARING_ONLY");
  });

  it("競合有料広告(competitor_paid_ads)は ANALYSIS である (⚠PoC問題(1)対応)", () => {
    expect(getResearchPolicy("competitor_paid_ads")).toBe("ANALYSIS");
  });

  it("存在しない key には undefined を返す", () => {
    expect(getResearchPolicy("not_a_real_key")).toBeUndefined();
  });
});
