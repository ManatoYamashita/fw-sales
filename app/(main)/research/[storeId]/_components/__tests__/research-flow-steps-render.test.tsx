/**
 * 上部の手順表示のアイコンと文言 (#324 の表示契約)。
 *
 * | 状態 | アイコン | 文言 |
 * | 実行中 | 回転アイコン | 実行中 |
 * | 完了 | チェック | 完了 |
 * | 失敗・時間超過 | 赤い「!」 | 失敗 / 時間超過 |
 * | 未着手・いまここ | ステップ番号 | 未着手 / いまここ |
 *
 * 終わった処理に回転アイコンを残さないこと、状態を色だけで伝えないこと (文言を必ず添える)
 * を固定する。
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ResearchFlowSteps } from "../research-flow-steps";
import { getResearchFlowSteps } from "@/lib/domain/research-flow";
import type { StoreResearchRun } from "@/types/research-run";

type FlowRun = Pick<StoreResearchRun, "status" | "review_completed_at">;

function render(run: FlowRun | null, overdue = false): string {
  return renderToStaticMarkup(
    <ResearchFlowSteps steps={getResearchFlowSteps(run, false, overdue)} />,
  );
}

/** ① (最初の li) の HTML。 */
function firstStep(html: string): string {
  return html.match(/<li[^>]*>.*?<\/li>/)![0];
}

const SPINNER = "animate-spin";

describe("ResearchFlowSteps の表示契約 (#324)", () => {
  it("実行中は回転アイコンと「実行中」", () => {
    const step = firstStep(render({ status: "running", review_completed_at: null }));
    expect(step).toContain(SPINNER);
    expect(step).toContain("(実行中)");
  });

  it("成功したら回転アイコンを止めてチェックと「完了」", () => {
    const step = firstStep(render({ status: "succeeded", review_completed_at: null }));
    expect(step).not.toContain(SPINNER);
    expect(step).toContain("lucide-check");
    expect(step).toContain("(完了)");
  });

  it("失敗したら回転アイコンを止めて赤い「!」と「失敗」(番号・いまここ とは区別する)", () => {
    const step = firstStep(render({ status: "failed", review_completed_at: null }));
    expect(step).not.toContain(SPINNER);
    expect(step).toContain(">!<");
    expect(step).toContain("bg-destructive");
    expect(step).toContain("(失敗)");
    expect(step).not.toContain("いまここ");
    expect(step).toContain('aria-current="step"');
  });

  it("期限を過ぎた実行中は回転アイコンを止めて赤い「!」と「時間超過」", () => {
    const step = firstStep(render({ status: "running", review_completed_at: null }, true));
    expect(step).not.toContain(SPINNER);
    expect(step).toContain(">!<");
    expect(step).toContain("(時間超過)");
  });

  it("run が無ければ番号と「いまここ」", () => {
    const step = firstStep(render(null));
    expect(step).not.toContain(SPINNER);
    expect(step).not.toContain(">!<");
    expect(step).toContain("(いまここ)");
  });

  it("回転アイコンが出るのは running の ① だけ (②③・終わった処理には出さない)", () => {
    for (const run of [
      null,
      { status: "failed", review_completed_at: null },
      { status: "succeeded", review_completed_at: null },
      { status: "succeeded", review_completed_at: "2026-10-10T00:00:00.000Z" },
    ] as const) {
      expect(render(run)).not.toContain(SPINNER);
      expect(render(run, true)).not.toContain(SPINNER);
    }
    expect(render({ status: "running", review_completed_at: null }).split(SPINNER)).toHaveLength(2);
  });
});
