import { describe, it, expect } from "vitest";
import {
  getResearchFlowSteps,
  getSalesAssetGenerationContext,
  salesAssetGenerateLabel,
  type ResearchFlowStepStatus,
} from "../research-flow";
import type { ResearchItem, ReviewDecisions } from "@/types/research-run";

type Run = Parameters<typeof getSalesAssetGenerationContext>[0] & object;

function run(overrides: Partial<Run>): Run {
  return {
    status: "succeeded",
    review_completed_at: null,
    result: [],
    review_decisions: {},
    ...overrides,
  };
}

function item(key: string, status: ResearchItem["status"]): ResearchItem {
  return { key, status } as ResearchItem;
}

function statuses(
  primaryRun: Run | null,
  hasAssets: boolean,
): ResearchFlowStepStatus[] {
  return getResearchFlowSteps(primaryRun, hasAssets).map((s) => s.status);
}

describe("getResearchFlowSteps", () => {
  it("手順は ① AI調査 → ② レビュー → ③ 営業資産を生成 の順", () => {
    expect(getResearchFlowSteps(null, false).map((s) => s.label)).toEqual([
      "AI調査",
      "レビュー",
      "営業資産を生成",
    ]);
  });

  it("run が無ければ ① が current", () => {
    expect(statuses(null, false)).toEqual(["current", "upcoming", "upcoming"]);
  });

  it("failed なら ① をやり直す", () => {
    expect(statuses(run({ status: "failed" }), false)).toEqual([
      "current",
      "upcoming",
      "upcoming",
    ]);
  });

  it("running なら ① が実行中", () => {
    expect(statuses(run({ status: "running" }), false)).toEqual([
      "running",
      "upcoming",
      "upcoming",
    ]);
  });

  it("succeeded かつ未レビューなら ② が current (営業資産の有無に依らない)", () => {
    expect(statuses(run({}), false)).toEqual(["done", "current", "upcoming"]);
    expect(statuses(run({}), true)).toEqual(["done", "current", "upcoming"]);
  });

  it("レビュー済みなら ③ が current、営業資産があれば ③ も done", () => {
    const reviewed = run({ review_completed_at: "2026-10-07T00:00:00.000Z" });
    expect(statuses(reviewed, false)).toEqual(["done", "done", "current"]);
    expect(statuses(reviewed, true)).toEqual(["done", "done", "done"]);
  });
});

describe("getSalesAssetGenerationContext", () => {
  it("run が無い / failed でレビュー済みの run も無いなら none", () => {
    expect(getSalesAssetGenerationContext(null, false)).toEqual({ kind: "none" });
    expect(getSalesAssetGenerationContext(run({ status: "failed" }), false)).toEqual({
      kind: "none",
    });
  });

  it("再調査が failed でも、以前の run がレビュー済みなら failedAfterReview (#313 レビュー)", () => {
    expect(getSalesAssetGenerationContext(run({ status: "failed" }), true)).toEqual({
      kind: "failedAfterReview",
    });
  });

  it("running なら running (以前のレビューの有無に依らない)", () => {
    for (const hasReviewedRun of [false, true]) {
      expect(
        getSalesAssetGenerationContext(run({ status: "running" }), hasReviewedRun),
      ).toEqual({ kind: "running" });
    }
  });

  it("レビュー済みなら reviewed", () => {
    expect(
      getSalesAssetGenerationContext(
        run({ review_completed_at: "2026-10-07T00:00:00.000Z" }),
        true,
      ),
    ).toEqual({ kind: "reviewed" });
  });

  it("未レビューなら、判断していない reviewable item の件数を数える", () => {
    const decisions: ReviewDecisions = {
      a: { decision: "adopted", decided_at: "2026-10-07T00:00:00.000Z" },
    };
    const ctx = getSalesAssetGenerationContext(
      run({
        result: [
          item("a", "confirmed"), // 判断済み (採用 = 基本情報へ反映済み)
          item("b", "confirmed"),
          item("c", "inferred"),
          item("d", "conflict"),
          item("e", "not_found"), // レビュー対象外
        ],
        review_decisions: decisions,
      }),
      false,
    );
    expect(ctx).toEqual({ kind: "unreviewed", undecidedCount: 3 });
  });
});

describe("salesAssetGenerateLabel", () => {
  it("レビュー済みだけが素の「営業資産を生成」、他は飛ばす手順をラベルに書く", () => {
    expect(salesAssetGenerateLabel({ kind: "reviewed" }, false)).toBe("営業資産を生成");
    expect(salesAssetGenerateLabel({ kind: "unreviewed", undecidedCount: 2 }, false)).toBe(
      "レビューせずに生成",
    );
    expect(salesAssetGenerateLabel({ kind: "running" }, false)).toBe(
      "調査の完了を待たずに生成",
    );
    expect(salesAssetGenerateLabel({ kind: "failedAfterReview" }, false)).toBe(
      "前回のレビュー結果で生成",
    );
    expect(salesAssetGenerateLabel({ kind: "none" }, false)).toBe("AI調査をせずに生成");
  });

  it("営業資産があれば「再生成」", () => {
    expect(salesAssetGenerateLabel({ kind: "reviewed" }, true)).toBe("営業資産を再生成");
    expect(salesAssetGenerateLabel({ kind: "failedAfterReview" }, true)).toBe(
      "前回のレビュー結果で再生成",
    );
    expect(salesAssetGenerateLabel({ kind: "none" }, true)).toBe("AI調査をせずに再生成");
  });
});
