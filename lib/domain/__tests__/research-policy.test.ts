/**
 * research_policy 定義表の単体検証(AI 店舗調査再設計 Plan v3.2 §7, PR1)
 *
 * `RESEARCH_POLICY_ITEMS` が `BASIC_INFO_ITEMS` と完全なkey集合一致を持つこと、
 * および集計(FACT=20 / ANALYSIS=17 / FACT_OR_HEARING=4 / HEARING_ONLY=10 /
 * EXTERNAL_DATA_REQUIRED=2、合計53、feat/ai-research-quality-refinementで
 * opening_date→FACT・population_day_night→EXTERNAL_DATA_REQUIREDへ変更)を検証する。
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

  it("項目単位の実カウントと一致する (FACT=20 / ANALYSIS=17 / FACT_OR_HEARING=4 / HEARING_ONLY=10 / EXTERNAL_DATA_REQUIRED=2)", () => {
    // feat/ai-research-quality-refinement での変更:
    // - opening_date: FACT_OR_HEARING → FACT(公開された客観的事実のため)
    // - population_day_night: ANALYSIS → EXTERNAL_DATA_REQUIRED(人流統計は専用
    //   データソース無しに正確な値を得られず、「繁華街だから人口が多い」という
    //   定性的推測を許してしまっていたため)
    const counts: Record<string, number> = {};
    for (const item of RESEARCH_POLICY_ITEMS) {
      counts[item.research_policy] = (counts[item.research_policy] ?? 0) + 1;
    }

    expect(counts.FACT).toBe(20);
    expect(counts.ANALYSIS).toBe(17);
    expect(counts.FACT_OR_HEARING).toBe(4);
    expect(counts.HEARING_ONLY).toBe(10);
    expect(counts.EXTERNAL_DATA_REQUIRED).toBe(2);

    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
    expect(total).toBe(53);
  });

  it("opening_date は FACT である (feat/ai-research-quality-refinement: 公開された客観的事実のため)", () => {
    expect(getResearchPolicy("opening_date")).toBe("FACT");
  });

  it("population_day_night は EXTERNAL_DATA_REQUIRED である (feat/ai-research-quality-refinement: 人流統計は専用データソースが必要)", () => {
    expect(getResearchPolicy("population_day_night")).toBe("EXTERNAL_DATA_REQUIRED");
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

/**
 * policy 別件数の drift ガード
 * (feat/ai-research-quality-ux-hardening、Plan §11.3 / Q12)。
 *
 * `lib/env.ts` と `lib/ai/research/client.ts` のコメントが「42項目」のままドリフトしていた
 * (`population_day_night` の ANALYSIS → EXTERNAL_DATA_REQUIRED 移動が未反映)。
 * Stage2 の出力トークン見積もりは項目数に線形なので、この数字がずれると
 * MAX_TOKENS 対策の判断自体が狂う。実数を固定して再発を防ぐ。
 */
describe("research_policy 別の項目数(drift ガード)", () => {
  const countBy = (policy: string) =>
    RESEARCH_POLICY_ITEMS.filter((item) => item.research_policy === policy).length;

  it("FACT=20 / FACT_OR_HEARING=4 / ANALYSIS=17 / HEARING_ONLY=10 / EXTERNAL_DATA_REQUIRED=2", () => {
    expect(countBy("FACT")).toBe(20);
    expect(countBy("FACT_OR_HEARING")).toBe(4);
    expect(countBy("ANALYSIS")).toBe(17);
    expect(countBy("HEARING_ONLY")).toBe(10);
    expect(countBy("EXTERNAL_DATA_REQUIRED")).toBe(2);
  });

  it("Stage2 が扱う項目数は 41(FACT + FACT_OR_HEARING + ANALYSIS)", () => {
    expect(countBy("FACT") + countBy("FACT_OR_HEARING") + countBy("ANALYSIS")).toBe(41);
  });

  it("AI呼出なしで機械生成する項目数は 12(HEARING_ONLY + EXTERNAL_DATA_REQUIRED)", () => {
    expect(countBy("HEARING_ONLY") + countBy("EXTERNAL_DATA_REQUIRED")).toBe(12);
  });

  it("合計は 53", () => {
    expect(RESEARCH_POLICY_ITEMS.length).toBe(53);
  });
});
