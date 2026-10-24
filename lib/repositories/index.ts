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
import type { EventLogRepository } from "./event-log-repository";
import type { StoreRepository } from "./store-repository";
import type { HandoffRepository } from "./handoff-repository";
import type { ProfileRepository } from "./profile-repository";
import type { MembershipRepository } from "./membership-repository";
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
  MembershipRepository,
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
 * 構造的型付けのため、`repos.forTenant(tenantId).transaction(async ({ deal, store }) => ...)`
 * 利用箇所(`createDealAction` / `updateDealAction`)は分割代入で 2 entity しか
 * 参照しないため非破壊で動作する。
 */
export interface TxRepos {
  profile: ProfileRepository;
  /** テナントへの所属とロール (マルチテナント化 #367) で追加。 */
  membership: MembershipRepository;
  notification: NotificationRepository;
  /** AI プロンプトテンプレート (Issue #42) で追加。 */
  promptTemplate: PromptTemplateRepository;
  /** アプリ全体設定 key-value (Issue #122) で追加。 */
  appSettings: AppSettingsRepository;
  // task 4.2 (PR3a): deepResearch を撤去 (#121 / #110 連動)。
  // Issue #110: 旧手入力調査テーブルの research も撤去。
}

/**
 * アプリ全体で参照される repository 集約 + transaction API。
 */
/** ユーザー領域の tx repository は後続 PR で移行する (#368)。 */
export interface TenantTxRepos extends TxRepos {
  /** AI 店舗調査の通常操作と行ロックを同じテナントに束縛する。 */
  researchRun: ResearchRunRepository;
  deal: DealRepository;
  handoff: HandoffRepository;
  store: StoreRepository;
  placeCandidate: PlaceCandidateRepository;
}

/** 移行済みの店舗・商談・調査領域はテナントを指定した入口からだけ利用できる。 */
export interface TenantRepos {
  researchRun: ResearchRunRepository;
  deal: DealRepository;
  handoff: HandoffRepository;
  store: StoreRepository;
  placeCandidate: PlaceCandidateRepository;
  transaction: <T>(fn: (tx: TenantTxRepos) => Promise<T>) => Promise<T>;
}

export interface Repos {
  forTenant: (tenantId: string) => TenantRepos;
  eventLog: EventLogRepository;
  profile: ProfileRepository;
  /** テナントへの所属とロール (マルチテナント化 #367) で追加。 */
  membership: MembershipRepository;
  notification: NotificationRepository;
  /** AI プロンプトテンプレート (Issue #42) で追加。 */
  promptTemplate: PromptTemplateRepository;
  /** アプリ全体設定 key-value (Issue #122) で追加。 */
  appSettings: AppSettingsRepository;
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
    dbEventLogRepo,
    dbProfileRepo,
    dbMembershipRepo,
    dbNotificationRepo,
    dbPromptTemplateRepo,
    dbAppSettingsRepo,
    makeDealRepo,
    makeStoreRepo,
    makeHandoffRepo,
    makeProfileRepo,
    makeMembershipRepo,
    makeNotificationRepo,
    makePromptTemplateRepo,
    makeAppSettingsRepo,
    makePlaceCandidateRepo,
    makeResearchRunRepo,
  } = dbModule;

  const legacyTxRepos = (executor: import("@/lib/db").DbClient | import("@/lib/db").Tx): TxRepos => ({
    profile: makeProfileRepo(executor), membership: makeMembershipRepo(executor),
    notification: makeNotificationRepo(executor), promptTemplate: makePromptTemplateRepo(executor),
    appSettings: makeAppSettingsRepo(executor),
  });
  const tenantTxRepos = (executor: import("@/lib/db").DbClient | import("@/lib/db").Tx, tenantId: string): TenantTxRepos => ({
    ...legacyTxRepos(executor),
    researchRun: makeResearchRunRepo(executor, tenantId),
    deal: makeDealRepo(executor, tenantId),
    handoff: makeHandoffRepo(executor, tenantId),
    store: makeStoreRepo(executor, tenantId),
    placeCandidate: makePlaceCandidateRepo(executor, tenantId),
  });

  return Object.freeze({
    forTenant(tenantId: string): TenantRepos {
      if (!tenantId.trim()) throw new Error("テナントが指定されていません");
      return Object.freeze({
        researchRun: makeResearchRunRepo(db, tenantId),
        deal: makeDealRepo(db, tenantId),
        handoff: makeHandoffRepo(db, tenantId),
        store: makeStoreRepo(db, tenantId),
        placeCandidate: makePlaceCandidateRepo(db, tenantId),
        transaction: <T>(fn: (tx: TenantTxRepos) => Promise<T>) =>
          db.transaction((tx) => fn(tenantTxRepos(tx, tenantId))),
      });
    },
    eventLog: dbEventLogRepo,
    profile: dbProfileRepo,
    membership: dbMembershipRepo,
    notification: dbNotificationRepo,
    promptTemplate: dbPromptTemplateRepo,
    appSettings: dbAppSettingsRepo,
    transaction: <T>(fn: (tx: TxRepos) => Promise<T>): Promise<T> =>
      db.transaction((tx) => fn(legacyTxRepos(tx))),
  }) satisfies Repos;
}

/**
 * top-level await により、モジュール初回 import 時に 1 度だけ buildRepos を
 * 評価する。以降の import では構築済み singleton が返る。
 */
export const repos: Repos = await buildRepos();
