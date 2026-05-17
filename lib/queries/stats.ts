import "server-only";
import { repos } from "@/lib/repositories";
import {
  CONTACTED_STAGES,
  NEGOTIATING_STAGES,
  ORDERED_STAGES,
} from "@/lib/domain/stages";
import { NAV_ITEMS } from "@/lib/domain/nav";

export interface DashboardStats {
  total: number;
  surveyed: number;
  waitResearch: number;
  dm: number;
  tel: number;
  contacted: number;
  dealsStage: number;
  orders: number;
  totalRevenue: number;
  monthlyRev: number;
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const [stores, handoffs] = await Promise.all([
    repos.store.list(),
    repos.handoff.list(),
  ]);

  const total = stores.length;
  const surveyed = stores.filter((s) => s.stage !== "調査待ち").length;
  const waitResearch = stores.filter((s) => s.stage === "調査待ち").length;
  const dm = stores.filter((s) => s.channel === "DM推奨").length;
  const tel = stores.filter((s) => s.channel === "テレアポ推奨").length;
  const contacted = stores.filter((s) =>
    CONTACTED_STAGES.includes(s.stage),
  ).length;
  const dealsStage = stores.filter((s) =>
    NEGOTIATING_STAGES.includes(s.stage),
  ).length;
  const orders = stores.filter((s) => ORDERED_STAGES.includes(s.stage)).length;

  const totalRevenue = handoffs.reduce(
    (sum, h) => sum + (h.initial_fee || 0),
    0,
  );
  const monthlyRev = handoffs
    .filter((h) => h.status === "完了")
    .reduce((sum, h) => sum + (h.monthly_fee || 0), 0);

  return {
    total,
    surveyed,
    waitResearch,
    dm,
    tel,
    contacted,
    dealsStage,
    orders,
    totalRevenue,
    monthlyRev,
  };
}

export interface NavBadgeCounts {
  stores: number;
  research: number;
  pipeline: number;
  deals: number;
  handoffs: number;
}

export async function getNavBadgeCounts(): Promise<NavBadgeCounts> {
  // disabled な menu のバッジは表示されないため、対応する list クエリも発火させない。
  // `NAV_ITEMS` を単一の真実として参照し、disable 解除時に自動的にバッジが復活する。
  const enabledBadgeKeys = new Set(
    NAV_ITEMS.filter((item) => !item.disabled && item.badgeKey).map(
      (item) => item.badgeKey as keyof NavBadgeCounts,
    ),
  );

  const needsStores =
    enabledBadgeKeys.has("stores") ||
    enabledBadgeKeys.has("research") ||
    enabledBadgeKeys.has("pipeline");
  const needsDeals = enabledBadgeKeys.has("deals");
  const needsHandoffs = enabledBadgeKeys.has("handoffs");

  const [stores, deals, handoffs] = await Promise.all([
    needsStores ? repos.store.list() : Promise.resolve([]),
    needsDeals ? repos.deal.list() : Promise.resolve([]),
    needsHandoffs ? repos.handoff.list() : Promise.resolve([]),
  ]);

  return {
    stores: enabledBadgeKeys.has("stores") ? stores.length : 0,
    research: enabledBadgeKeys.has("research")
      ? stores.filter((s) => s.stage === "調査待ち").length
      : 0,
    pipeline: enabledBadgeKeys.has("pipeline")
      ? stores.filter((s) => s.stage !== "引き継ぎ完了").length
      : 0,
    deals: enabledBadgeKeys.has("deals")
      ? deals.filter((d) => d.status !== "失注" && d.status !== "受注").length
      : 0,
    handoffs: enabledBadgeKeys.has("handoffs")
      ? handoffs.filter((h) => h.status === "運用確認待ち").length
      : 0,
  };
}
