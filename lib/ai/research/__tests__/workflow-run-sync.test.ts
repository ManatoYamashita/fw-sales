/**
 * Workflow run とアプリの run の突き合わせ (#324)。
 *
 * enqueue 後に実行基盤で失敗した run を `failed` として記録すること、そして
 * 「正常な長時間処理」「実行基盤に問い合わせられない」場合に失敗と断定しないことを固定する。
 */

import { describe, expect, it, vi } from "vitest";
import type { StoreResearchRun, StoreResearchRunPatch } from "@/types/research-run";

vi.mock("workflow/api", () => ({ getRun: vi.fn() }));
vi.mock("@/lib/repositories", () => ({ repos: { researchRun: {} } }));

const {
  dropBlankVercelUrl,
  linkWorkflowRun,
  readWorkflowRunId,
  syncRunWithWorkflow,
  WORKFLOW_RUN_ENDED_ERROR_KINDS,
} = await import("../workflow-run-sync");

const NOW = "2026-10-10T01:40:30.000Z";

function makeRun(overrides: Partial<StoreResearchRun> = {}): StoreResearchRun {
  return {
    id: "research_run_1",
    store_id: "store-1",
    requested_by_user_id: "user-1",
    status: "running",
    stage: null,
    result: null,
    source_registry: [],
    review_decisions: {},
    review_completed_at: null,
    token_usage: { workflow_run_id: "wrun_1" },
    warnings: [],
    error_kind: null,
    error_message: null,
    started_at: "2026-10-10T01:39:57.000Z",
    expires_at: "2026-10-10T02:09:57.000Z",
    finished_at: null,
    ...overrides,
  };
}

function deps(status: () => Promise<string>, latest: StoreResearchRun | null = null) {
  const updateIfRunning = vi.fn(async (id: string, patch: StoreResearchRunPatch) =>
    latest === null ? ({ ...makeRun({ id }), ...patch } as StoreResearchRun) : null,
  );
  const get = vi.fn(async () => latest);
  return {
    getWorkflowRunStatus: vi.fn(status),
    runs: { updateIfRunning, get },
    now: () => NOW,
    timeoutMs: 50,
  };
}

describe("syncRunWithWorkflow", () => {
  it.each(Object.entries(WORKFLOW_RUN_ENDED_ERROR_KINDS))(
    "実行基盤が %s で終わっていて run が running なら、failed (%s) として記録する",
    async (workflowStatus, errorKind) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const d = deps(async () => workflowStatus);

      const result = await syncRunWithWorkflow(makeRun(), d);

      expect(d.getWorkflowRunStatus).toHaveBeenCalledWith("wrun_1");
      expect(d.runs.updateIfRunning).toHaveBeenCalledWith("research_run_1", {
        status: "failed",
        error_kind: errorKind,
        error_message: "AI店舗調査に失敗しました",
        finished_at: NOW,
      });
      expect(result.markedFailed).toBe(true);
      expect(result.run.status).toBe("failed");
    },
  );

  it.each(["pending", "running"])(
    "実行基盤が %s なら (正常な処理中・長時間の処理を含む) 何も書き込まない",
    async (workflowStatus) => {
      const d = deps(async () => workflowStatus);
      const run = makeRun({ started_at: "2026-10-10T00:00:00.000Z" });

      const result = await syncRunWithWorkflow(run, d);

      expect(d.runs.updateIfRunning).not.toHaveBeenCalled();
      expect(result).toEqual({ run, markedFailed: false });
    },
  );

  it("実行基盤への問い合わせが失敗したら、失敗と断定せずそのまま返す (例外の中身はログに出さない)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const d = deps(async () => {
      throw new Error("WorkflowAPIError: unauthorized token=secret-123");
    });
    const run = makeRun();

    const result = await syncRunWithWorkflow(run, d);

    expect(result).toEqual({ run, markedFailed: false });
    expect(d.runs.updateIfRunning).not.toHaveBeenCalled();
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret-123");
    warn.mockRestore();
  });

  it("実行基盤が応答しなければ打ち切り、そのまま返す (他の Server Action を待たせない)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const d = deps(() => new Promise<string>(() => {}));

    const result = await syncRunWithWorkflow(makeRun(), d);

    expect(result.markedFailed).toBe(false);
    expect(d.runs.updateIfRunning).not.toHaveBeenCalled();
  });

  it("問い合わせの間に Workflow が結果を記録していたら (CAS miss)、その記録を返して上書きしない", async () => {
    const recorded = makeRun({ status: "failed", error_kind: "fatal:auth_error" });
    const d = deps(async () => "failed", recorded);

    const result = await syncRunWithWorkflow(makeRun(), d);

    expect(result).toEqual({ run: recorded, markedFailed: false });
  });

  it("running 以外の run と、Workflow run ID の記録が無い run は問い合わせない", async () => {
    const d = deps(async () => "failed");

    await syncRunWithWorkflow(makeRun({ status: "succeeded" }), d);
    await syncRunWithWorkflow(makeRun({ status: "failed" }), d);
    await syncRunWithWorkflow(makeRun({ token_usage: null }), d);

    expect(d.getWorkflowRunStatus).not.toHaveBeenCalled();
  });
});

describe("readWorkflowRunId", () => {
  it("token_usage.workflow_run_id の文字列だけを読む", () => {
    expect(readWorkflowRunId({ token_usage: { workflow_run_id: "wrun_x" } })).toBe("wrun_x");
    expect(readWorkflowRunId({ token_usage: null })).toBeNull();
    expect(readWorkflowRunId({ token_usage: { workflow_run_id: "" } })).toBeNull();
    expect(readWorkflowRunId({ token_usage: { workflow_run_id: 1 } })).toBeNull();
    expect(readWorkflowRunId({ token_usage: { stage1: {} } })).toBeNull();
  });
});

describe("linkWorkflowRun", () => {
  it("running の run にだけ記録する (compare-and-swap)", async () => {
    const updateIfRunning = vi.fn(async () => null);
    await linkWorkflowRun("research_run_1", "wrun_1", { updateIfRunning });
    expect(updateIfRunning).toHaveBeenCalledWith("research_run_1", {
      token_usage: { workflow_run_id: "wrun_1" },
    });
  });

  it("記録に失敗しても例外を投げない", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const updateIfRunning = vi.fn(async () => {
      throw new Error("connection refused 10.0.0.7");
    });
    await expect(linkWorkflowRun("r", "w", { updateIfRunning })).resolves.toBeUndefined();
    expect(JSON.stringify(error.mock.calls)).not.toContain("10.0.0.7");
    error.mockRestore();
  });
});

describe("dropBlankVercelUrl", () => {
  it("空文字・空白だけの VERCEL_URL を未定義に戻す", () => {
    for (const blank of ["", "  "]) {
      const env: Record<string, string | undefined> = { VERCEL_URL: blank };
      dropBlankVercelUrl(env);
      expect("VERCEL_URL" in env).toBe(false);
    }
  });

  it("値の入った VERCEL_URL と未定義はそのまま", () => {
    const set: Record<string, string | undefined> = { VERCEL_URL: "fw-sales.vercel.app" };
    dropBlankVercelUrl(set);
    expect(set.VERCEL_URL).toBe("fw-sales.vercel.app");

    const unset: Record<string, string | undefined> = {};
    dropBlankVercelUrl(unset);
    expect(unset).toEqual({});
  });

  /**
   * SDK の判定 (`process.env.VERCEL_URL !== undefined`) と URL 組み立てを再現し、
   * 空文字のままだと Invalid URL になること、正規化すれば通ることを確かめる。
   * `@workflow/core` を更新して判定が変わったら、このテストの前提も見直すこと。
   */
  it("SDK と同じ組み立てで、空文字のままだと Invalid URL・正規化後は localhost で通る", () => {
    const buildBaseUrl = (env: Record<string, string | undefined>) =>
      new URL(env.VERCEL_URL !== undefined ? `https://${env.VERCEL_URL}` : "http://localhost:3000")
        .origin;

    expect(() => buildBaseUrl({ VERCEL_URL: "" })).toThrow(TypeError);
    const env: Record<string, string | undefined> = { VERCEL_URL: "" };
    dropBlankVercelUrl(env);
    expect(buildBaseUrl(env)).toBe("http://localhost:3000");
  });
});
