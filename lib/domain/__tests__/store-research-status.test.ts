import { describe, expect, it } from "vitest";
import {
  compareStoreResearchStatus,
  getStoreResearchStatus,
  isStoreResearchStatus,
  RESEARCH_REVIEW_PENDING,
  STORE_RESEARCH_STATUSES,
} from "@/lib/domain/store-research-status";
import { STAGE_IDS } from "@/types/stage";

describe("getStoreResearchStatus", () => {
  it.each(STAGE_IDS)("未レビューの調査結果があれば stage=%s でもレビュー待ちになる", (stage) => {
    expect(getStoreResearchStatus(stage, true)).toBe(RESEARCH_REVIEW_PENDING);
  });

  it.each(STAGE_IDS)("未レビューの調査結果が無ければ stage=%s をそのまま返す", (stage) => {
    expect(getStoreResearchStatus(stage, false)).toBe(stage);
  });
});

describe("STORE_RESEARCH_STATUSES", () => {
  it("全ステージとレビュー待ちを作業の進み具合の順に 1 つずつ持つ", () => {
    expect(STORE_RESEARCH_STATUSES).toEqual(["未調査", "レビュー待ち", "調査済み", "架電済み"]);
  });

  it("チャネル値の「要確認」とは別の語を使う", () => {
    expect(STORE_RESEARCH_STATUSES).not.toContain("要確認");
  });
});

describe("isStoreResearchStatus", () => {
  it("既知の値だけを受け付ける", () => {
    expect(isStoreResearchStatus("レビュー待ち")).toBe(true);
    expect(isStoreResearchStatus("調査済み")).toBe(true);
    expect(isStoreResearchStatus("要確認")).toBe(false);
    expect(isStoreResearchStatus("")).toBe(false);
  });
});

describe("compareStoreResearchStatus", () => {
  it("レビュー待ちは未調査と調査済みの間に並ぶ", () => {
    const sorted = (["架電済み", "調査済み", "レビュー待ち", "未調査"] as const)
      .slice()
      .sort(compareStoreResearchStatus);
    expect(sorted).toEqual(["未調査", "レビュー待ち", "調査済み", "架電済み"]);
  });
});
