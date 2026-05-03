/**
 * リポジトリ層 composition root。
 *
 * 役割:
 * - Mock 経路 / DB 経路の切替を `process.env.USE_MOCK_DB` 1 点で行う
 *   single source of truth。
 * - `repos.transaction(fn)` API を提供し、複数リポジトリにまたがる書込みを
 *   1 トランザクションで原子的に実行する手段を上位層 (actions/*) に与える。
 *
 * 設計上のポイント:
 * - DB 経路の `lib/db/*` は **動的 import** (`await import("@/lib/db")`) で
 *   解決する。Mock モード時には DB バレルのトップレベル評価が走らないため、
 *   `DATABASE_URL` 未設定でも開発サーバが起動できる (Issue 1 / Issue 2)。
 * - 動的 import のパスは静的に解析可能なリテラル (`@/lib/db`) を用い、
 *   バンドラの bundle-analyzable-paths 規約に準拠する。
 * - `buildRepos()` は **top-level await** でモジュール初回 import 時に
 *   1 度だけ評価され、結果は `Object.freeze` で immutable な singleton として
 *   保持される。Next.js 16 + React 19 + tsconfig "module": "esnext" 環境では
 *   top-level await が標準サポートされる。
 * - Mock 経路の `transaction` は擬似実装である。rollback は不可、
 *   シリアル実行のみ保証する (本物のトランザクション境界が欲しいテストでは
 *   DB 経路を利用すること)。
 *
 * 関連: design.md §「`lib/repositories/index.ts` (修正)」 (Issue 1/2 対応),
 *       requirements.md §3.2 §3.3 §5.1 §5.2 §5.4 §9.4
 */

import "server-only";

import { mockDealRepo } from "@/lib/mock/deal";
import { mockStoreRepo } from "@/lib/mock/store";
import { mockResearchRepo } from "@/lib/mock/research";
import { mockHandoffRepo } from "@/lib/mock/handoff";

import type { DealRepository } from "./deal-repository";
import type { StoreRepository } from "./store-repository";
import type { ResearchRepository } from "./research-repository";
import type { HandoffRepository } from "./handoff-repository";

export type {
  DealRepository,
  StoreRepository,
  ResearchRepository,
  HandoffRepository,
};

/**
 * トランザクション境界内で利用可能なリポジトリ集合。
 * `transaction` のコールバックに渡される `tx` 引数の型。
 */
export interface TxRepos {
  deal: DealRepository;
  store: StoreRepository;
}

/**
 * アプリ全体で参照される repository 集約 + transaction API。
 */
export interface Repos {
  store: StoreRepository;
  research: ResearchRepository;
  deal: DealRepository;
  handoff: HandoffRepository;
  /**
   * 複数リポジトリ書込みを 1 トランザクションで実行する。
   * - DB 経路: `db.transaction` で BEGIN/COMMIT/ROLLBACK を自動制御。
   * - Mock 経路: 擬似実装。fn を await で直列実行するのみで rollback 不可。
   */
  transaction: <T>(fn: (tx: TxRepos) => Promise<T>) => Promise<T>;
}

async function buildRepos(): Promise<Repos> {
  const useMock = process.env.USE_MOCK_DB === "true";

  if (useMock) {
    // Mock 経路: DB バレルを一切評価しない。
    // transaction は擬似実装 — fn にそのまま mock repo を渡す。
    return Object.freeze({
      store: mockStoreRepo,
      research: mockResearchRepo,
      deal: mockDealRepo,
      handoff: mockHandoffRepo,
      transaction: async <T>(fn: (tx: TxRepos) => Promise<T>): Promise<T> =>
        fn({ deal: mockDealRepo, store: mockStoreRepo }),
    }) satisfies Repos;
  }

  // DB 経路: 静的に解析可能なパスで動的 import (bundle-analyzable-paths 準拠)。
  // Mock モード時はこの import が評価されないため、DATABASE_URL 未設定でも
  // 起動可能 (Issue 1)。
  const dbModule = await import("@/lib/db");
  const { db, dbDealRepo, dbStoreRepo, makeDealRepo, makeStoreRepo } = dbModule;

  return Object.freeze({
    store: dbStoreRepo,
    // research / handoff は別 Issue で DB 化される予定。現状は mock のまま。
    research: mockResearchRepo,
    deal: dbDealRepo,
    handoff: mockHandoffRepo,
    transaction: <T>(fn: (tx: TxRepos) => Promise<T>): Promise<T> =>
      db.transaction(async (tx) =>
        fn({ deal: makeDealRepo(tx), store: makeStoreRepo(tx) }),
      ),
  }) satisfies Repos;
}

/**
 * top-level await により、モジュール初回 import 時に 1 度だけ buildRepos を
 * 評価する。以降の import では構築済み singleton が返る。
 */
export const repos: Repos = await buildRepos();
