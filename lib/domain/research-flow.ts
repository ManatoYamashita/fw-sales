/**
 * `/research/[storeId]` の推奨手順 (Issue #300)。
 *
 * 店舗登録後の手順を 1 本に固定し、いまどこにいるかを run の状態から導出する。
 *
 *   ① AI調査 → ② レビュー (採用した項目が基本情報に入る) → ③ 営業資産を生成
 *
 * 営業資産の生成 (`generateSalesAssetsAction`) が読むのは `store.basic_info` だけで、
 * AI 調査の結果はレビューで採用して初めて生成に使われる。この事実を生成セクションの
 * 文言 (`getSalesAssetGenerationContext`) で利用者に示す。
 *
 * 純関数。`lib/ai` は import しない。
 */

import { getUndecidedReviewableItems } from "./research-review";
import type { StoreResearchRun } from "@/types/research-run";

export type ResearchFlowStepKey = "research" | "review" | "generate";

/**
 * - `current`  いま行うステップ
 * - `running`  実行中で待つだけのステップ (AI 調査の進行中)
 * - `done`     完了したステップ
 * - `upcoming` まだ到達していないステップ
 */
export type ResearchFlowStepStatus = "current" | "running" | "done" | "upcoming";

export interface ResearchFlowStep {
  key: ResearchFlowStepKey;
  label: string;
  status: ResearchFlowStepStatus;
}

export const RESEARCH_FLOW_STEP_LABELS: Record<ResearchFlowStepKey, string> = {
  research: "AI調査",
  review: "レビュー",
  generate: "営業資産を生成",
};

type FlowRun = Pick<StoreResearchRun, "status" | "review_completed_at">;

function steps(
  research: ResearchFlowStepStatus,
  review: ResearchFlowStepStatus,
  generate: ResearchFlowStepStatus,
): ResearchFlowStep[] {
  return [
    { key: "research", label: RESEARCH_FLOW_STEP_LABELS.research, status: research },
    { key: "review", label: RESEARCH_FLOW_STEP_LABELS.review, status: review },
    { key: "generate", label: RESEARCH_FLOW_STEP_LABELS.generate, status: generate },
  ];
}

/**
 * 主表示 run (`selectPrimaryResearchRun`) と営業資産の有無から、3 ステップの状態を返す。
 *
 * - run なし / failed: ① が current
 * - running: ① が running
 * - succeeded かつ未レビュー: ② が current
 * - レビュー済み: ③ が current。営業資産があれば ③ も done
 */
export function getResearchFlowSteps(
  primaryRun: FlowRun | null,
  hasAssets: boolean,
): ResearchFlowStep[] {
  if (primaryRun === null || primaryRun.status === "failed") {
    return steps("current", "upcoming", "upcoming");
  }
  if (primaryRun.status === "running") {
    return steps("running", "upcoming", "upcoming");
  }
  if (primaryRun.review_completed_at === null) {
    return steps("done", "current", "upcoming");
  }
  return steps("done", "done", hasAssets ? "done" : "current");
}

/** 生成セクションの文脈。ボタンの強さと説明文を決める。 */
export type SalesAssetGenerationContext =
  | { kind: "reviewed" }
  /** `undecidedCount`: レビューで未対応のため基本情報に入っていない調査結果の件数。 */
  | { kind: "unreviewed"; undecidedCount: number }
  | { kind: "running" }
  | { kind: "none" };

export function getSalesAssetGenerationContext(
  primaryRun: Pick<
    StoreResearchRun,
    "status" | "review_completed_at" | "result" | "review_decisions"
  > | null,
): SalesAssetGenerationContext {
  if (primaryRun === null || primaryRun.status === "failed") return { kind: "none" };
  if (primaryRun.status === "running") return { kind: "running" };
  if (primaryRun.review_completed_at !== null) return { kind: "reviewed" };
  return {
    kind: "unreviewed",
    undecidedCount: getUndecidedReviewableItems(
      primaryRun.result ?? [],
      primaryRun.review_decisions,
    ).length,
  };
}

/**
 * 生成ボタンのラベル。レビュー済みのときだけ主導線 (primary) にし、それ以外は
 * 「何を飛ばして生成するのか」をラベルに書く。
 */
export function salesAssetGenerateLabel(
  context: SalesAssetGenerationContext,
  hasAssets: boolean,
): string {
  const verb = hasAssets ? "再生成" : "生成";
  switch (context.kind) {
    case "reviewed":
      return `営業資産を${verb}`;
    case "unreviewed":
      return `レビューせずに${verb}`;
    case "running":
      return `調査の完了を待たずに${verb}`;
    case "none":
      return `AI調査をせずに${verb}`;
  }
}
