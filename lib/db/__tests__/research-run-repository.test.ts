/**
 * makeResearchRunRepo のユニットテスト
 * (AI 店舗調査再設計 Plan v3.2, PR1: データモデル基盤)
 *
 * テスト方針: `place-candidate-repository.test.ts` と同じ Proxy-based mock
 * executor パターンを踏襲する。実 DB 接続はしない。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/client", () => ({
  db: {},
}));

import { makeResearchRunRepo } from "../research-run-repository";
import type { DbClient } from "@/lib/db/client";
import type { StoreResearchRun } from "@/types/research-run";

function makeSelectProxy(terminal: unknown[]): object {
  const handler: ProxyHandler<object> = {
    get(_target, prop: string | symbol) {
      if (prop === "then") {
        return (
          onFulfilled: (v: unknown[]) => unknown,
          onRejected?: (e: unknown) => unknown,
        ) => Promise.resolve(terminal).then(onFulfilled, onRejected);
      }
      return () => new Proxy({}, handler);
    },
  };
  return new Proxy({}, handler);
}

function makeWriteCapture() {
  const inserted: Record<string, unknown>[] = [];
  const updated: Record<string, unknown>[] = [];

  const insert = vi.fn(() => ({
    values: (values: Record<string, unknown>) => {
      inserted.push(values);
      return Promise.resolve([]);
    },
  }));

  const update = vi.fn(() => ({
    set: (set: Record<string, unknown>) => {
      updated.push(set);
      return { where: () => Promise.resolve([]) };
    },
  }));

  return { insert, update, inserted, updated };
}

function makeMockExecutor(selectRows: unknown[] = []) {
  const { insert, update, inserted, updated } = makeWriteCapture();
  return {
    select: vi.fn().mockReturnValue(makeSelectProxy(selectRows)),
    insert,
    update,
    delete: vi.fn(),
    inserted,
    updated,
  };
}

function makeExistingRow(
  overrides: Partial<StoreResearchRun> = {},
): StoreResearchRun {
  return {
    id: "research_run_existing",
    store_id: "store_1",
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
    started_at: "2026-08-02T00:00:00.000Z",
    expires_at: "2026-08-02T00:10:00.000Z",
    finished_at: null,
    ...overrides,
  };
}

describe("makeResearchRunRepo.create", () => {
  it("status='running' で新規行を作成する", async () => {
    const executor = makeMockExecutor();
    const repo = makeResearchRunRepo(executor as unknown as DbClient);

    const result = await repo.create({
      store_id: "store_1",
      requested_by_user_id: null,
    });

    expect(result.status).toBe("running");
    expect(result.store_id).toBe("store_1");
    expect(result.source_registry).toEqual([]);
    expect(result.review_decisions).toEqual({});
    expect(result.warnings).toEqual([]);
    expect(executor.inserted).toHaveLength(1);
    expect(executor.inserted[0]!.status).toBe("running");
  });

  it("expires_at は started_at より後の時刻になる", async () => {
    const executor = makeMockExecutor();
    const repo = makeResearchRunRepo(executor as unknown as DbClient);

    const result = await repo.create({
      store_id: "store_1",
      requested_by_user_id: null,
    });

    expect(Date.parse(result.expires_at)).toBeGreaterThan(
      Date.parse(result.started_at),
    );
  });

  it("id は research_run_ プレフィックスを持つ", async () => {
    const executor = makeMockExecutor();
    const repo = makeResearchRunRepo(executor as unknown as DbClient);

    const result = await repo.create({
      store_id: "store_1",
      requested_by_user_id: null,
    });

    expect(result.id).toMatch(/^research_run_/);
  });
});

describe("makeResearchRunRepo.get", () => {
  it("存在するidなら行を返す", async () => {
    const row = makeExistingRow();
    const executor = makeMockExecutor([row]);
    const repo = makeResearchRunRepo(executor as unknown as DbClient);

    const result = await repo.get("research_run_existing");

    expect(result).toEqual(row);
  });

  it("存在しないidならnullを返す", async () => {
    const executor = makeMockExecutor([]);
    const repo = makeResearchRunRepo(executor as unknown as DbClient);

    const result = await repo.get("research_run_missing");

    expect(result).toBeNull();
  });

  it("破損したsource_registry(配列でない)は空配列にフェイルセーフする", async () => {
    const row = { ...makeExistingRow(), source_registry: "not-an-array" };
    const executor = makeMockExecutor([row]);
    const repo = makeResearchRunRepo(executor as unknown as DbClient);

    const result = await repo.get("research_run_existing");

    expect(result?.source_registry).toEqual([]);
  });

  it("破損したreview_decisions(配列)は空オブジェクトにフェイルセーフする", async () => {
    const row = { ...makeExistingRow(), review_decisions: ["not", "an", "object"] };
    const executor = makeMockExecutor([row]);
    const repo = makeResearchRunRepo(executor as unknown as DbClient);

    const result = await repo.get("research_run_existing");

    expect(result?.review_decisions).toEqual({});
  });

  it("不正なstatus文字列はrunningにフェイルセーフする", async () => {
    const row = { ...makeExistingRow(), status: "unknown_status" };
    const executor = makeMockExecutor([row]);
    const repo = makeResearchRunRepo(executor as unknown as DbClient);

    const result = await repo.get("research_run_existing");

    expect(result?.status).toBe("running");
  });
});

describe("makeResearchRunRepo.getLatestForStore", () => {
  it("started_at降順の先頭1件を返す (orderByはDB側だが、mockは渡された1件をそのまま返す)", async () => {
    const row = makeExistingRow({ started_at: "2026-08-02T01:00:00.000Z" });
    const executor = makeMockExecutor([row]);
    const repo = makeResearchRunRepo(executor as unknown as DbClient);

    const result = await repo.getLatestForStore("store_1");

    expect(result).toEqual(row);
  });

  it("該当runが無ければnullを返す", async () => {
    const executor = makeMockExecutor([]);
    const repo = makeResearchRunRepo(executor as unknown as DbClient);

    const result = await repo.getLatestForStore("store_missing");

    expect(result).toBeNull();
  });
});

describe("makeResearchRunRepo.update", () => {
  let executor: ReturnType<typeof makeMockExecutor>;

  beforeEach(() => {
    executor = makeMockExecutor();
  });

  it("存在しないidはnullを返しupdateを呼ばない", async () => {
    executor = makeMockExecutor([]);
    const repo = makeResearchRunRepo(executor as unknown as DbClient);

    const result = await repo.update("research_run_missing", { status: "succeeded" });

    expect(result).toBeNull();
    expect(executor.updated).toHaveLength(0);
  });

  it("statusを更新できる", async () => {
    const existing = makeExistingRow({ status: "running" });
    executor = makeMockExecutor([existing]);
    const repo = makeResearchRunRepo(executor as unknown as DbClient);

    const result = await repo.update("research_run_existing", { status: "succeeded" });

    expect(result?.status).toBe("succeeded");
    expect(executor.updated[0]!.status).toBe("succeeded");
  });

  it("id / store_id / started_at / expires_at は変更されない (パッチに含めても無視される型)", async () => {
    const existing = makeExistingRow();
    executor = makeMockExecutor([existing]);
    const repo = makeResearchRunRepo(executor as unknown as DbClient);

    const result = await repo.update("research_run_existing", { status: "failed" });

    expect(result?.id).toBe(existing.id);
    expect(result?.store_id).toBe(existing.store_id);
    expect(result?.started_at).toBe(existing.started_at);
    expect(result?.expires_at).toBe(existing.expires_at);
  });

  it("review_completed_atを設定できる (レビュー完了操作)", async () => {
    const existing = makeExistingRow({ review_completed_at: null });
    executor = makeMockExecutor([existing]);
    const repo = makeResearchRunRepo(executor as unknown as DbClient);

    const result = await repo.update("research_run_existing", {
      review_completed_at: "2026-08-02T02:00:00.000Z",
    });

    expect(result?.review_completed_at).toBe("2026-08-02T02:00:00.000Z");
  });

  it("review_decisionsをマージではなく丸ごと置き換える", async () => {
    const existing = makeExistingRow({
      review_decisions: {
        key1: { decision: "adopted", decided_at: "2026-08-02T00:00:00.000Z" },
      },
    });
    executor = makeMockExecutor([existing]);
    const repo = makeResearchRunRepo(executor as unknown as DbClient);

    const result = await repo.update("research_run_existing", {
      review_decisions: {
        key2: { decision: "rejected", decided_at: "2026-08-02T01:00:00.000Z" },
      },
    });

    expect(result?.review_decisions).toEqual({
      key2: { decision: "rejected", decided_at: "2026-08-02T01:00:00.000Z" },
    });
  });

  it("warningsを更新できる (Places再同期失敗の記録等)", async () => {
    const existing = makeExistingRow({ warnings: [] });
    executor = makeMockExecutor([existing]);
    const repo = makeResearchRunRepo(executor as unknown as DbClient);

    const result = await repo.update("research_run_existing", {
      warnings: ["Places情報の再取得に失敗しました"],
    });

    expect(result?.warnings).toEqual(["Places情報の再取得に失敗しました"]);
  });
});
