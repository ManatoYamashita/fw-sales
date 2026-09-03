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
import type { HandoffRepository } from "./handoff-repository";
import type { ProfileRepository } from "./profile-repository";
import type { NotificationRepository } from "./notification-repository";
import type { PromptTemplateRepository } from "./prompt-template-repository";
import type { AppSettingsRepository } from "./app-settings-repository";
import type { PlaceCandidateRepository } from "./place-candidate-repository";
import type { ResearchRunRepository } from "./research-run-repository";

export type {
  DealRepository,
  StoreRepository,
  HandoffRepository,
  ProfileRepository,
  NotificationRepository,
  PromptTemplateRepository,
  AppSettingsRepository,
  PlaceCandidateRepository,
  ResearchRunRepository,
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
  handoff: HandoffRepository;
  profile: ProfileRepository;
  notification: NotificationRepository;
  /** AI プロンプトテンプレート (Issue #42) で追加。 */
  promptTemplate: PromptTemplateRepository;
  /** アプリ全体設定 key-value (Issue #122) で追加。 */
  appSettings: AppSettingsRepository;
  /** エリア検索 候補DB保存の土台 (Issue #129 follow-up) で追加。 */
  placeCandidate: PlaceCandidateRepository;
  /** AI 店舗調査 run (AI 店舗調査再設計 Plan v3.2, PR1) で追加。 */
  researchRun: ResearchRunRepository;
  // task 4.2 (PR3a): deepResearch を撤去 (#121 / #110 連動)。
  // Issue #110: 旧手入力調査テーブルの research も撤去。
}

/**
 * アプリ全体で参照される repository 集約 + transaction API。
 */
export interface Repos {
  store: StoreRepository;
  deal: DealRepository;
  handoff: HandoffRepository;
  profile: ProfileRepository;
  notification: NotificationRepository;
  /** AI プロンプトテンプレート (Issue #42) で追加。 */
  promptTemplate: PromptTemplateRepository;
  /** アプリ全体設定 key-value (Issue #122) で追加。 */
  appSettings: AppSettingsRepository;
  /** エリア検索 候補DB保存の土台 (Issue #129 follow-up) で追加。 */
  placeCandidate: PlaceCandidateRepository;
  /** AI 店舗調査 run (AI 店舗調査再設計 Plan v3.2, PR1) で追加。 */
  researchRun: ResearchRunRepository;
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
    dbHandoffRepo,
    dbProfileRepo,
    dbNotificationRepo,
    dbPromptTemplateRepo,
    dbAppSettingsRepo,
    dbPlaceCandidateRepo,
    dbResearchRunRepo,
    makeDealRepo,
    makeStoreRepo,
    makeHandoffRepo,
    makeProfileRepo,
    makeNotificationRepo,
    makePromptTemplateRepo,
    makeAppSettingsRepo,
    makePlaceCandidateRepo,
    makeResearchRunRepo,
  } = dbModule;

  return Object.freeze({
    store: dbStoreRepo,
    deal: dbDealRepo,
    handoff: dbHandoffRepo,
    profile: dbProfileRepo,
    notification: dbNotificationRepo,
    promptTemplate: dbPromptTemplateRepo,
    appSettings: dbAppSettingsRepo,
    placeCandidate: dbPlaceCandidateRepo,
    researchRun: dbResearchRunRepo,
    transaction: <T>(fn: (tx: TxRepos) => Promise<T>): Promise<T> =>
      db.transaction(async (tx) =>
        fn({
          deal: makeDealRepo(tx),
          store: makeStoreRepo(tx),
          handoff: makeHandoffRepo(tx),
          profile: makeProfileRepo(tx),
          notification: makeNotificationRepo(tx),
          promptTemplate: makePromptTemplateRepo(tx),
          appSettings: makeAppSettingsRepo(tx),
          placeCandidate: makePlaceCandidateRepo(tx),
          researchRun: makeResearchRunRepo(tx),
        }),
      ),
  }) satisfies Repos;
}

/**
 * top-level await により、モジュール初回 import 時に 1 度だけ buildRepos を
 * 評価する。以降の import では構築済み singleton が返る。
 */
export const repos: Repos = await buildRepos();
