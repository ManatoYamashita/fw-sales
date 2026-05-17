import "server-only";
import type { Store } from "@/types/store";
import type { Research } from "@/types/research";
import type { Deal } from "@/types/deal";
import type { Handoff } from "@/types/handoff";
import type { Profile } from "@/types/profile";
import type { Notification } from "@/types/notification";
import type {
  DeepResearchJob,
  DeepResearchReport,
} from "@/types/deep-research";
import {
  SEED_STORES,
  SEED_RESEARCH,
  SEED_DEALS,
  SEED_HANDOFFS,
  SEED_PROFILES,
} from "./seed";

interface MockDb {
  stores: Map<string, Store>;
  research: Map<string, Research>;
  deals: Map<string, Deal>;
  handoffs: Map<string, Handoff>;
  profiles: Map<string, Profile>;
  notifications: Map<string, Notification>;
  /** deep-research-pipeline spec (Issue #43) で追加。SEED は無く空 Map で起動。 */
  deepResearchJobs: Map<string, DeepResearchJob>;
  /** deep-research-pipeline spec (Issue #43) で追加。 */
  deepResearchReports: Map<string, DeepResearchReport>;
}

const globalKey = Symbol.for("__FW_SALES_MOCK_DB__");

interface GlobalWithDb {
  [globalKey]?: MockDb;
}

function buildInitialDb(): MockDb {
  return {
    stores: new Map(SEED_STORES.map((s) => [s.id, { ...s }])),
    research: new Map(SEED_RESEARCH.map((r) => [r.id, { ...r }])),
    deals: new Map(SEED_DEALS.map((d) => [d.id, { ...d }])),
    handoffs: new Map(SEED_HANDOFFS.map((h) => [h.id, { ...h }])),
    profiles: new Map(SEED_PROFILES.map((p) => [p.id, { ...p }])),
    notifications: new Map(),
    deepResearchJobs: new Map(),
    deepResearchReports: new Map(),
  };
}

const g = globalThis as unknown as GlobalWithDb;
export const mockDb: MockDb = g[globalKey] ?? (g[globalKey] = buildInitialDb());

export function resetMockDb(): void {
  const fresh = buildInitialDb();
  mockDb.stores = fresh.stores;
  mockDb.research = fresh.research;
  mockDb.deals = fresh.deals;
  mockDb.handoffs = fresh.handoffs;
  mockDb.profiles = fresh.profiles;
  mockDb.notifications = fresh.notifications;
  mockDb.deepResearchJobs = fresh.deepResearchJobs;
  mockDb.deepResearchReports = fresh.deepResearchReports;
}

export function clearMockDb(): void {
  mockDb.stores.clear();
  mockDb.research.clear();
  mockDb.deals.clear();
  mockDb.handoffs.clear();
  mockDb.profiles.clear();
  mockDb.notifications.clear();
  mockDb.deepResearchJobs.clear();
  mockDb.deepResearchReports.clear();
}

export interface DbSnapshot {
  stores: Store[];
  research: Research[];
  deals: Deal[];
  handoffs: Handoff[];
  /** auth-and-notifications spec で追加。export/import 経路への組込は後続タスクで実施。 */
  profiles?: Profile[];
  notifications?: Notification[];
}

export function snapshotMockDb(): DbSnapshot {
  return {
    stores: [...mockDb.stores.values()],
    research: [...mockDb.research.values()],
    deals: [...mockDb.deals.values()],
    handoffs: [...mockDb.handoffs.values()],
    profiles: [...mockDb.profiles.values()],
    notifications: [...mockDb.notifications.values()],
  };
}

export function restoreMockDb(snapshot: Partial<DbSnapshot>): void {
  if (snapshot.stores) {
    mockDb.stores = new Map(snapshot.stores.map((s) => [s.id, { ...s }]));
  }
  if (snapshot.research) {
    mockDb.research = new Map(snapshot.research.map((r) => [r.id, { ...r }]));
  }
  if (snapshot.deals) {
    mockDb.deals = new Map(snapshot.deals.map((d) => [d.id, { ...d }]));
  }
  if (snapshot.handoffs) {
    mockDb.handoffs = new Map(snapshot.handoffs.map((h) => [h.id, { ...h }]));
  }
  if (snapshot.profiles) {
    mockDb.profiles = new Map(snapshot.profiles.map((p) => [p.id, { ...p }]));
  }
  if (snapshot.notifications) {
    mockDb.notifications = new Map(
      snapshot.notifications.map((n) => [n.id, { ...n }]),
    );
  }
}
