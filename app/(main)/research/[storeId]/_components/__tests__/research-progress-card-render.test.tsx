/**
 * `ResearchProgressCard` の表示 (#324)。
 *
 * - 正常な処理中 / 目安超過 (期限前) / 期限超過 / 進捗を確認できない、を区別して出す
 * - 止まった確証の無い run に「中断しました」と出さない
 * - 実行できない環境では再調査のボタンを出さない
 *
 * jsdom を入れていないため `renderToStaticMarkup` で描画する。ポーリングの状態は
 * hook をモックして与える (取得そのものの判定は `checkResearchRunStatus` のテストが担う)。
 */

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoreResearchRun } from "@/types/research-run";

const { mockPolling, mockElapsed } = vi.hoisted(() => ({
  mockPolling: vi.fn(),
  mockElapsed: vi.fn(),
}));

vi.mock("../use-research-run-polling", () => ({
  useResearchRunPolling: mockPolling,
  useElapsedSeconds: mockElapsed,
}));

const { ResearchProgressCard, statusCheckProblemMessage, EXPECTED_MAX_SECONDS } = await import(
  "../research-progress-card"
);

const RUN: StoreResearchRun = {
  id: "research_run_1",
  store_id: "store-1",
  requested_by_user_id: null,
  status: "running",
  stage: "discovering",
  result: null,
  source_registry: [],
  review_decisions: {},
  review_completed_at: null,
  token_usage: null,
  warnings: [],
  error_kind: null,
  error_message: null,
  started_at: "2026-10-10T01:00:00.000Z",
  expires_at: "2026-10-10T01:30:00.000Z",
  finished_at: null,
};

function render({
  overdue = false,
  unavailableMessage = null,
}: { overdue?: boolean; unavailableMessage?: string | null } = {}): string {
  return renderToStaticMarkup(
    <ResearchProgressCard
      run={RUN}
      onUpdate={() => {}}
      overdue={overdue}
      onRetry={() => {}}
      retrying={false}
      unavailableMessage={unavailableMessage}
    />,
  );
}

beforeEach(() => {
  mockPolling.mockReturnValue({ problem: null, rechecking: false, recheck: () => {} });
  mockElapsed.mockReturnValue(90);
});

describe("ResearchProgressCard (#324)", () => {
  it("正常な処理中は工程と経過時間を出し、異常や再調査は出さない", () => {
    const html = render();
    expect(html).toContain("Web情報源を検索");
    expect(html).toContain("経過時間: 1分30秒");
    expect(html).not.toContain("目安の時間を過ぎています");
    expect(html).not.toContain("再調査する");
    expect(html).not.toContain('role="alert"');
  });

  it("目安を過ぎても期限前なら、正常な長時間処理として待つよう伝える (失敗とは言わない)", () => {
    mockElapsed.mockReturnValue(EXPECTED_MAX_SECONDS + 46);
    const html = render();
    expect(html).toContain("目安の時間を過ぎていますが、処理は続いています。");
    expect(html).not.toContain("調査に失敗しました");
    expect(html).not.toContain("中断");
    expect(html).not.toContain("再調査する");
    expect(html).not.toContain('role="alert"');
  });

  it("期限を過ぎたら異常として示し再調査を出すが、「中断しました」とは断定しない", () => {
    const html = render({ overdue: true });
    expect(html).toContain("上限の時間を過ぎても調査が終わっていません");
    expect(html).toContain("開始から30分を過ぎても");
    expect(html).toContain("処理が止まっている可能性があります");
    expect(html).toContain("再調査する");
    expect(html).not.toContain("中断しました");
    expect(html).toContain('role="alert"');
  });

  it("期限超過でも、実行できない環境なら再調査を出さず理由を示す", () => {
    const reason = "この検証環境ではAI調査を実行できません。店舗情報の入力や画面の確認はできます。";
    const html = render({ overdue: true, unavailableMessage: reason });
    expect(html).toContain(reason);
    expect(html).not.toContain("再調査する");
    expect(html).not.toContain("打ち切って新しく調査し直します");
  });

  it("進捗を取得できないときは「進捗を確認できません」と再確認の操作を出す (調査の失敗とは区別する)", () => {
    mockPolling.mockReturnValue({
      problem: { kind: "network" },
      rechecking: false,
      recheck: () => {},
    });
    const html = render();
    expect(html).toContain("進捗を確認できません。通信状況を確認して、もう一度確認してください。");
    expect(html).toContain("調査そのものは続いている可能性があります");
    expect(html).toContain("進捗を再確認");
    expect(html).not.toContain("調査に失敗しました");
    // 進捗の表示 (工程・経過時間) は残す
    expect(html).toContain("経過時間");
  });

  it("ログインが切れているときは再ログインの導線を出す", () => {
    mockPolling.mockReturnValue({
      problem: { kind: "signed_out" },
      rechecking: false,
      recheck: () => {},
    });
    const html = render();
    expect(html).toContain("ログインの有効期限が切れた可能性があります");
    expect(html).toContain('href="/login"');
    expect(html).toContain("ログインし直す");
  });
});

describe("statusCheckProblemMessage", () => {
  it("Action が返した理由はそのまま添える (Action の固定文のみで、例外の中身ではない)", () => {
    expect(
      statusCheckProblemMessage({ kind: "rejected", message: "調査結果が見つかりません" }),
    ).toBe(
      "進捗を確認できません(調査結果が見つかりません)。ページを再読み込みして、もう一度確認してください。",
    );
  });

  it("どの理由でも「進捗を確認できません」で始める", () => {
    for (const problem of [
      { kind: "network" },
      { kind: "signed_out" },
      { kind: "rejected", message: "x" },
    ] as const) {
      expect(statusCheckProblemMessage(problem).startsWith("進捗を確認できません")).toBe(true);
    }
  });
});
