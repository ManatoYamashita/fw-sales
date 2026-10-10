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
  /**
   * 直近の調査は失敗したが、以前の調査はレビュー済み。採用済みの項目は基本情報に
   * 入っているので「AI 調査をしていない」扱いにはしない。
   */
  | { kind: "failedAfterReview" }
  | { kind: "none" };

/**
 * @param hasReviewedRun 店舗の run のうち、レビューを完了したものが 1 件でもあるか。
 *   主表示 run は最新の run なので、再調査が失敗するとそれだけでは過去のレビューが見えない。
 */
export function getSalesAssetGenerationContext(
  primaryRun: Pick<
    StoreResearchRun,
    "status" | "review_completed_at" | "result" | "review_decisions"
  > | null,
  hasReviewedRun: boolean,
): SalesAssetGenerationContext {
  if (primaryRun === null) return { kind: "none" };
  if (primaryRun.status === "failed") {
    return hasReviewedRun ? { kind: "failedAfterReview" } : { kind: "none" };
  }
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
    case "failedAfterReview":
      return `前回のレビュー結果で${verb}`;
    case "none":
      return `AI調査をせずに${verb}`;
  }
}

// ---- ③ 営業資産を生成 の開閉 (Issue #322) ----------------------------------
//
// 推奨順序に沿う初期表示と、手順を飛ばす任意操作を両立させるための状態。
//
// - ① AI調査・② レビューが完了するまでは ③ を閉じて始め、いまの作業に集中させる。
// - ただし ③ は ①② を飛ばしても使えるので、閉じていても利用者はいつでも手動で開ける。
//   折りたたみを「使ってはいけない」の意味にしない。
// - 一度利用者が開閉したら、ポーリングや再描画で取り消さない。自動で開くのは
//   「② が完了した瞬間」(= ③ に到達した) だけで、自動で閉じることはない。

/**
 * ③ に到達しているか (= ① AI調査と ② レビューが完了しているか)。
 *
 * 判定は手順表示 (`getResearchFlowSteps`) の ② の状態と一致させる。レビューの未対応が
 * 0 件でも、レビュー完了操作をしていなければ ② は完了ではない。
 */
export function isGenerateStepReached(steps: readonly ResearchFlowStep[]): boolean {
  return steps.find((s) => s.key === "review")?.status === "done";
}

export interface SalesAssetDisclosure {
  /** 利用者が最後に選んだ開閉。null は未操作で、既定 (`autoOpen`) に従う。 */
  manual: boolean | null;
  /** ③ に到達したことで開いているか。一度 true になったら自動では戻さない。 */
  autoOpen: boolean;
  /** 直前に受け取った `isGenerateStepReached`。到達した瞬間を見分けるために持つ。 */
  reached: boolean;
}

export function initialSalesAssetDisclosure(reached: boolean): SalesAssetDisclosure {
  return { manual: null, autoOpen: reached, reached };
}

/**
 * 最新の到達状態を反映する。変化が無ければ**同じオブジェクトを返す** (呼び出し側は
 * 参照の一致で「更新不要」を判定する)。
 *
 * - 未到達 → 到達: レビュー完了という利用者自身の操作の結果なので、次の作業へ進めるよう
 *   開く。手動で閉じていても開く。
 * - 到達 → 未到達 (再調査を始めた等): 開閉は変えない。入力の途中で閉じないため。
 */
export function syncSalesAssetDisclosure(
  state: SalesAssetDisclosure,
  reached: boolean,
): SalesAssetDisclosure {
  if (state.reached === reached) return state;
  if (reached) return { manual: null, autoOpen: true, reached };
  return { ...state, reached };
}

/**
 * いま開いているか。
 *
 * @param revealed `#sales-assets` へのリンクで来たか。着地先が閉じていると導線が切れるので、
 *   利用者が手動で閉じるまでは開いた状態にする。
 */
export function isSalesAssetDisclosureOpen(
  state: SalesAssetDisclosure,
  revealed: boolean,
): boolean {
  return state.manual ?? (state.autoOpen || revealed);
}

/** 開閉ボタンの操作。いま見えている状態の逆を、利用者の選択として記録する。 */
export function toggleSalesAssetDisclosure(
  state: SalesAssetDisclosure,
  revealed: boolean,
): SalesAssetDisclosure {
  return { ...state, manual: !isSalesAssetDisclosureOpen(state, revealed) };
}
