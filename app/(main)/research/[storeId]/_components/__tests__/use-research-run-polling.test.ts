/**
 * 進捗の取得結果の判定 (#324)。
 *
 * 旧実装は `res.ok === false` と通信の例外を黙って捨てていたため、取得できなくても
 * 画面は「進行中」のまま経過時間だけが増えた。取得できなかったことを理由付きで返し、
 * 調査そのものの失敗 (run.status === "failed") とは区別する。
 */

import { describe, expect, it, vi } from "vitest";
import type { StoreResearchRun } from "@/types/research-run";

// Server Action の実体 (repositories → DB) を読み込まないよう差し替える。
vi.mock("@/lib/actions/research-run-actions", () => ({ getResearchRunStatusAction: vi.fn() }));

const { checkResearchRunStatus, classifyStatusCheckFailure } = await import(
  "../use-research-run-polling"
);

const RUN = { id: "research_run_1", status: "failed" } as StoreResearchRun;

describe("checkResearchRunStatus", () => {
  it("取得できたら最新の run を返す (失敗した run も「取得できた」側)", async () => {
    const fetchStatus = vi.fn(async () => ({ ok: true as const, data: RUN }));
    expect(await checkResearchRunStatus("research_run_1", fetchStatus)).toEqual({
      ok: true,
      run: RUN,
    });
    expect(fetchStatus).toHaveBeenCalledWith("research_run_1");
  });

  it("Action が断った (res.ok === false) ら理由を返す", async () => {
    const fetchStatus = vi.fn(async () => ({ ok: false as const, error: "ログインが必要です" }));
    expect(await checkResearchRunStatus("r", fetchStatus)).toEqual({
      ok: false,
      problem: { kind: "signed_out" },
    });
  });

  it("通信の例外は外へ漏らさず network として返す (例外の中身は使わない)", async () => {
    const fetchStatus = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await checkResearchRunStatus("r", fetchStatus)).toEqual({
      ok: false,
      problem: { kind: "network" },
    });
  });
});

describe("classifyStatusCheckFailure", () => {
  it("未ログイン / それ以外の理由 / 応答なし を分ける", () => {
    expect(classifyStatusCheckFailure("ログインが必要です")).toEqual({ kind: "signed_out" });
    expect(classifyStatusCheckFailure("調査結果が見つかりません")).toEqual({
      kind: "rejected",
      message: "調査結果が見つかりません",
    });
    expect(classifyStatusCheckFailure(null)).toEqual({ kind: "network" });
  });
});
