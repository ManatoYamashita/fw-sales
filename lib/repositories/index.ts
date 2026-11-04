/**
 * リポジトリ層 composition root。
 *
 * 役割:
 * - `repos.forTenant(tenantId).transaction(fn)` API を提供し、複数リポジトリにまたがる書込みを
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

import type { DataRepository } from "./data-repository";
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
  DataRepository,
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

/** 同じテナントとtransaction接続に束縛する業務repository。 */
export interface TenantTxRepos {
  profile: ProfileRepository;
  membership: MembershipRepository;
  notification: NotificationRepository;
  promptTemplate: PromptTemplateRepository;
  appSettings: AppSettingsRepository;
  researchRun: ResearchRunRepository;
  deal: DealRepository;
  handoff: HandoffRepository;
  store: StoreRepository;
  placeCandidate: PlaceCandidateRepository;
}

/** 監査は業務commit後、専用プールへ書くためtransactionには含めない。 */
export interface TenantRepos extends TenantTxRepos {
  data: DataRepository;
  eventLog: EventLogRepository;
  transaction: <T>(fn: (tx: TenantTxRepos) => Promise<T>) => Promise<T>;
}

/** テナントを指定しないrepository・transactionの入口は提供しない。 */
export interface Repos {
  forTenant: (tenantId: string) => TenantRepos;
}

async function buildRepos(): Promise<Repos> {
  const {
    db, auditDb, makeDataRepo, makeEventLogRepo, makeProfileRepo, makeMembershipRepo,
    makeNotificationRepo, makePromptTemplateRepo, makeAppSettingsRepo,
    makeResearchRunRepo, makeDealRepo, makeHandoffRepo, makeStoreRepo, makePlaceCandidateRepo,
  } = await import("@/lib/db");
  const tenantTxRepos = (executor: import("@/lib/db").DbClient | import("@/lib/db").Tx, tenantId: string): TenantTxRepos => ({
    profile: makeProfileRepo(executor, tenantId),
    membership: makeMembershipRepo(executor, tenantId),
    notification: makeNotificationRepo(executor, tenantId),
    promptTemplate: makePromptTemplateRepo(executor, tenantId),
    appSettings: makeAppSettingsRepo(executor, tenantId),
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
        ...tenantTxRepos(db, tenantId),
        data: makeDataRepo(db, tenantId),
        eventLog: makeEventLogRepo(auditDb, tenantId),
        transaction: <T>(fn: (tx: TenantTxRepos) => Promise<T>) =>
          db.transaction((tx) => fn(tenantTxRepos(tx, tenantId))),
      });
    },
  }) satisfies Repos;
}

export const repos: Repos = await buildRepos();
