import { describe, it, expect } from "vitest";
import {
  getResearchFlowSteps,
  getSalesAssetGenerationContext,
  initialSalesAssetDisclosure,
  isGenerateStepReached,
  isSalesAssetDisclosureOpen,
  salesAssetGenerateLabel,
  syncSalesAssetDisclosure,
  toggleSalesAssetDisclosure,
  type ResearchFlowStepStatus,
  type SalesAssetDisclosure,
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

describe("isGenerateStepReached (#322)", () => {
  it.each([
    { name: "未調査", run: null },
    { name: "調査失敗", run: run({ status: "failed" }) },
    { name: "調査中", run: run({ status: "running" }) },
    { name: "調査完了・レビュー未完了", run: run({ status: "succeeded" }) },
  ])("$name なら未到達 (③ は閉じて始める)", ({ run: r }) => {
    expect(isGenerateStepReached(getResearchFlowSteps(r, false))).toBe(false);
  });

  it("レビューの未対応が 0 件でも、レビュー完了操作をしていなければ未到達", () => {
    const r = run({
      result: [item("phone", "confirmed")],
      review_decisions: {
        phone: { decision: "adopted", decided_at: "2026-10-10T00:00:00.000Z" },
      },
    });
    expect(getSalesAssetGenerationContext(r, false)).toEqual({
      kind: "unreviewed",
      undecidedCount: 0,
    });
    expect(isGenerateStepReached(getResearchFlowSteps(r, false))).toBe(false);
  });

  it.each([false, true])("レビュー完了なら到達 (営業資産あり=%s)", (hasAssets) => {
    const r = run({ review_completed_at: "2026-10-10T00:00:00.000Z" });
    expect(isGenerateStepReached(getResearchFlowSteps(r, hasAssets))).toBe(true);
  });

  it("手順表示の ② が done のときと一致する", () => {
    const runs = [
      null,
      run({ status: "failed" }),
      run({ status: "running" }),
      run({}),
      run({ review_completed_at: "2026-10-10T00:00:00.000Z" }),
    ];
    for (const r of runs) {
      for (const hasAssets of [false, true]) {
        const steps = getResearchFlowSteps(r, hasAssets);
        expect(isGenerateStepReached(steps)).toBe(
          steps.find((s) => s.key === "review")?.status === "done",
        );
      }
    }
  });
});

describe("SalesAssetDisclosure (#322)", () => {
  const open = (s: SalesAssetDisclosure, revealed = false) =>
    isSalesAssetDisclosureOpen(s, revealed);

  it("初期状態は到達状態に従う", () => {
    expect(open(initialSalesAssetDisclosure(false))).toBe(false);
    expect(open(initialSalesAssetDisclosure(true))).toBe(true);
  });

  it("未到達でも手動で開ける (①② を生成の必須条件にしない)", () => {
    const s = toggleSalesAssetDisclosure(initialSalesAssetDisclosure(false), false);
    expect(open(s)).toBe(true);
  });

  it("到達済みでも手動で閉じられ、もう一度押すと開く", () => {
    const closed = toggleSalesAssetDisclosure(initialSalesAssetDisclosure(true), false);
    expect(open(closed)).toBe(false);
    expect(open(toggleSalesAssetDisclosure(closed, false))).toBe(true);
  });

  it("到達状態が変わらない再描画 (ポーリング等) は同じオブジェクトを返し、手動操作を取り消さない", () => {
    for (const reached of [false, true]) {
      const manual = toggleSalesAssetDisclosure(initialSalesAssetDisclosure(reached), false);
      const synced = syncSalesAssetDisclosure(manual, reached);
      expect(synced).toBe(manual);
      expect(open(synced)).toBe(!reached);
    }
  });

  it("未到達 → 到達 (レビュー完了) で開く。手動で閉じていても開いて次の作業へ進める", () => {
    expect(open(syncSalesAssetDisclosure(initialSalesAssetDisclosure(false), true))).toBe(true);
    // 閉じたままの状態を手動で選んでいた (一度開いて閉じた) 場合も同じ。
    const manuallyClosed = toggleSalesAssetDisclosure(
      toggleSalesAssetDisclosure(initialSalesAssetDisclosure(false), false),
      false,
    );
    expect(open(manuallyClosed)).toBe(false);
    expect(open(syncSalesAssetDisclosure(manuallyClosed, true))).toBe(true);
  });

  it("到達 → 未到達 (再調査の開始) では閉じない。入力の途中で本文を隠さない", () => {
    const s = syncSalesAssetDisclosure(initialSalesAssetDisclosure(true), false);
    expect(open(s)).toBe(true);
    // その後またレビューを完了しても開いたまま。
    expect(open(syncSalesAssetDisclosure(s, true))).toBe(true);
  });

  it("到達 → 未到達 → 到達 の往復でも、2 回目の到達で手動の閉を開け直す", () => {
    let s = initialSalesAssetDisclosure(true);
    s = syncSalesAssetDisclosure(s, false);
    s = toggleSalesAssetDisclosure(s, false);
    expect(open(s)).toBe(false);
    s = syncSalesAssetDisclosure(s, true);
    expect(open(s)).toBe(true);
  });

  it("`#sales-assets` で来たら未到達でも開いて始め、利用者が閉じればそれに従う", () => {
    const s = initialSalesAssetDisclosure(false);
    expect(open(s, true)).toBe(true);
    const closed = toggleSalesAssetDisclosure(s, true);
    expect(open(closed, true)).toBe(false);
    expect(open(toggleSalesAssetDisclosure(closed, true), true)).toBe(true);
  });
});
