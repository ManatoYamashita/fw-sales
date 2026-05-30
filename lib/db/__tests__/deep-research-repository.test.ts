/**
 * deep-research-repository の findStalledResearchingJobs クエリ単体テスト。
 *
 * 進捗停滞 (stall) 検知の誤検知防止 (R5.6) の核心は WHERE 句に集約される:
 *   status='researching' / deleted_at IS NULL / research_started_at < startedBefore (grace) /
 *   api_updated_at IS NOT NULL (positive evidence) / api_updated_at < staleBefore /
 *   order by api_updated_at asc / limit clamp(0..100)
 *
 * これらを実 DB なしで回帰検出するため、recording executor で .where()/.orderBy()/.limit()
 * を捕捉し、PgDialect で生成 SQL を文字列化して述語の存在を検証する。誰かが
 * isNotNull(api_updated_at) や grace の lt(research_started_at, ...) を削除すると SQL から
 * 該当句が消えてテストが落ちる。
 */

import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

// `../deep-research-repository` は import 時に `./client` の `db` (= DATABASE_URL 必須) を
// 評価する。本テストは executor を直接渡すため実接続は不要 → client をスタブ化する。
vi.mock("../client", () => ({ db: {} }));

import { makeDeepResearchRepo } from "../deep-research-repository";
import type { DbClient } from "../client";

interface Captured {
  selectCalled: number;
  where?: SQL;
  orderBy?: SQL;
  limit?: number;
}

/**
 * .select().from().where().orderBy().limit() チェーンを記録する偽 executor。
 * .limit() で Promise<[]> を返し、WHERE/ORDER BY/LIMIT の引数を捕捉する。
 */
function makeRecordingExecutor(): { executor: DbClient; captured: Captured } {
  const captured: Captured = { selectCalled: 0 };
  const chain = {
    select() {
      captured.selectCalled += 1;
      return this;
    },
    from() {
      return this;
    },
    where(w: SQL) {
      captured.where = w;
      return this;
    },
    orderBy(o: SQL) {
      captured.orderBy = o;
      return this;
    },
    limit(n: number) {
      captured.limit = n;
      return Promise.resolve([]);
    },
  };
  return { executor: chain as unknown as DbClient, captured };
}

function renderSql(node: SQL | undefined): string {
  if (!node) return "";
  return new PgDialect().sqlToQuery(node).sql.toLowerCase();
}

const STALE_BEFORE = new Date("2026-05-30T10:00:00.000Z");
const STARTED_BEFORE = new Date("2026-05-30T11:00:00.000Z");

describe("findStalledResearchingJobs — WHERE 句 (誤検知防止の核心)", () => {
  it("status=researching / deleted_at IS NULL / grace / positive-evidence / stale を全て含む", async () => {
    const { executor, captured } = makeRecordingExecutor();
    await makeDeepResearchRepo(executor).findStalledResearchingJobs(
      STALE_BEFORE,
      STARTED_BEFORE,
      5,
    );

    const where = renderSql(captured.where);
    // status = 'researching'
    expect(where).toContain('"status"');
    // deleted_at IS NULL
    expect(where).toContain('"deleted_at" is null');
    // grace: research_started_at < $
    expect(where).toMatch(/"research_started_at"\s*<\s*\$/);
    // positive evidence: api_updated_at IS NOT NULL (これが消えると NULL を誤検知する)
    expect(where).toContain('"api_updated_at" is not null');
    // 進捗凍結: api_updated_at < $
    expect(where).toMatch(/"api_updated_at"\s*<\s*\$/);
  });

  it("'researching' をパラメータとして渡す (status フィルタが緩まないこと)", async () => {
    const { executor, captured } = makeRecordingExecutor();
    await makeDeepResearchRepo(executor).findStalledResearchingJobs(
      STALE_BEFORE,
      STARTED_BEFORE,
      5,
    );
    const query = new PgDialect().sqlToQuery(captured.where as SQL);
    expect(query.params).toContain("researching");
  });

  it("api_updated_at の昇順 (最も古い停滞から処理)", async () => {
    const { executor, captured } = makeRecordingExecutor();
    await makeDeepResearchRepo(executor).findStalledResearchingJobs(
      STALE_BEFORE,
      STARTED_BEFORE,
      5,
    );
    const order = renderSql(captured.orderBy);
    expect(order).toContain('"api_updated_at"');
    expect(order).toContain("asc");
  });
});

describe("findStalledResearchingJobs — limit clamp (deadline 保護)", () => {
  it("limit=0 は executor を呼ばず空配列を返す", async () => {
    const { executor, captured } = makeRecordingExecutor();
    const rows = await makeDeepResearchRepo(executor).findStalledResearchingJobs(
      STALE_BEFORE,
      STARTED_BEFORE,
      0,
    );
    expect(rows).toEqual([]);
    expect(captured.selectCalled).toBe(0);
  });

  it("負の limit も executor を呼ばず空配列を返す", async () => {
    const { executor, captured } = makeRecordingExecutor();
    const rows = await makeDeepResearchRepo(executor).findStalledResearchingJobs(
      STALE_BEFORE,
      STARTED_BEFORE,
      -5,
    );
    expect(rows).toEqual([]);
    expect(captured.selectCalled).toBe(0);
  });

  it("limit=200 は 100 にクランプされる", async () => {
    const { executor, captured } = makeRecordingExecutor();
    await makeDeepResearchRepo(executor).findStalledResearchingJobs(
      STALE_BEFORE,
      STARTED_BEFORE,
      200,
    );
    expect(captured.limit).toBe(100);
  });

  it("通常値 (5) はそのまま limit に渡る", async () => {
    const { executor, captured } = makeRecordingExecutor();
    await makeDeepResearchRepo(executor).findStalledResearchingJobs(
      STALE_BEFORE,
      STARTED_BEFORE,
      5,
    );
    expect(captured.limit).toBe(5);
  });
});
