/**
 * リポジトリ層 composition root。
 *
 * 役割:
 * - `repos.transaction(fn)` API を提供し、複数リポジトリにまたがる書込みを
 *   1 トランザクションで原子的に実行する手段を上位層 (actions/*) に与える。
 *
 * 設計上のポイント:
 * - `lib/db/*` は **動的 import** (`await import("@/lib/db")`) で解決する。
 *   動的 import のパスは静的に解析可能なリテラル (`@/lib/db`) を用い、
 *   バンドラの bundle-analyzable-paths 規約に準拠する。
 * - `buildRepos()` は **top-level await** でモジュール初回 import 時に
 *   1 度だけ評価され、結果は `Object.freeze` で immutable な singleton として
 *   保持される。Next.js 16 + React 19 + tsconfig "module": "esnext" 環境では
 *   top-level await が標準サポートされる。
 *
 * 関連: design.md §「`lib/repositories/index.ts` (修正)」 (Issue 1/2 対応 +
 *       research-handoff-db-migration §3),
 *       requirements.md §3.2 §3.3 §5.1 §5.2 §5.4 §9.4 +
 *       research-handoff-db-migration §4.4 §4.5 §6.x §9.4 §11.1〜§11.3
 */

import "server-only";

import type { DealRepository } from "./deal-repository";
import type { StoreRepository } from "./store-repository";
import type { ResearchRepository } from "./research-repository";
import type { HandoffRepository } from "./handoff-repository";
import type { ProfileRepository } from "./profile-repository";
import type { NotificationRepository } from "./notification-repository";

export type {
  DealRepository,
  StoreRepository,
  ResearchRepository,
  HandoffRepository,
  ProfileRepository,
  NotificationRepository,
};

/**
 * トランザクション境界内で利用可能なリポジトリ集合。
 * `transaction` のコールバックに渡される `tx` 引数の型。
 *
 * research-handoff-db-migration spec で `research` / `handoff` を追加した。
 * 構造的型付けのため、既存の `repos.transaction(async ({ deal, store }) => ...)`
 * 利用箇所(`createDealAction` / `updateDealAction`)は分割代入で 2 entity しか
 * 参照しないため非破壊で動作する。
 */
export interface TxRepos {
  deal: DealRepository;
  store: StoreRepository;
  research: ResearchRepository;
  handoff: HandoffRepository;
  profile: ProfileRepository;
  notification: NotificationRepository;
}

/**
 * アプリ全体で参照される repository 集約 + transaction API。
 */
export interface Repos {
  store: StoreRepository;
  research: ResearchRepository;
  deal: DealRepository;
  handoff: HandoffRepository;
  profile: ProfileRepository;
  notification: NotificationRepository;
  /**
   * 複数リポジトリ書込みを 1 トランザクションで実行する。
   * `db.transaction` で BEGIN/COMMIT/ROLLBACK を自動制御。
   */
  transaction: <T>(fn: (tx: TxRepos) => Promise<T>) => Promise<T>;
}

async function buildRepos(): Promise<Repos> {
  // 静的に解析可能なパスで動的 import (bundle-analyzable-paths 準拠)。
  const dbModule = await import("@/lib/db");
  const {
    db,
    dbDealRepo,
    dbStoreRepo,
    dbResearchRepo,
    dbHandoffRepo,
    dbProfileRepo,
    dbNotificationRepo,
    makeDealRepo,
    makeStoreRepo,
    makeResearchRepo,
    makeHandoffRepo,
    makeProfileRepo,
    makeNotificationRepo,
  } = dbModule;

  return Object.freeze({
    store: dbStoreRepo,
    research: dbResearchRepo,
    deal: dbDealRepo,
    handoff: dbHandoffRepo,
    profile: dbProfileRepo,
    notification: dbNotificationRepo,
    transaction: <T>(fn: (tx: TxRepos) => Promise<T>): Promise<T> =>
      db.transaction(async (tx) =>
        fn({
          deal: makeDealRepo(tx),
          store: makeStoreRepo(tx),
          research: makeResearchRepo(tx),
          handoff: makeHandoffRepo(tx),
          profile: makeProfileRepo(tx),
          notification: makeNotificationRepo(tx),
        }),
      ),
  }) satisfies Repos;
}

/**
 * top-level await により、モジュール初回 import 時に 1 度だけ buildRepos を
 * 評価する。以降の import では構築済み singleton が返る。
 */
export const repos: Repos = await buildRepos();
