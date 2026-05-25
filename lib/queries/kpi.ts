import "server-only";
import { cacheTag } from "next/cache";
import { repos } from "@/lib/repositories";
import { CACHE_TAGS } from "@/lib/cache";
import {
  CONTACTED_STAGES,
  NEGOTIATING_STAGES,
  ORDERED_STAGES,
} from "@/lib/domain/stages";
import { csvToList } from "@/lib/utils/format";
import { SERVICE_OPTIONS } from "@/lib/domain/services";

export interface FunnelStep {
  label: string;
  count: number;
  rate: number; // % vs 直前
}

export interface KpiSnapshot {
  funnel: FunnelStep[];
  channelBreakdown: Array<{ channel: string; count: number; share: number }>;
  serviceBreakdown: Array<{ service: string; count: number; share: number }>;
  totalRevenue: number;
  monthlyRecurring: number;
}

export async function getKpiSnapshot(): Promise<KpiSnapshot> {
  "use cache";
  cacheTag(CACHE_TAGS.kpi, CACHE_TAGS.stores, CACHE_TAGS.handoffs);

  const [stores, handoffs] = await Promise.all([
    repos.store.list(),
    repos.handoff.list(),
  ]);
  const total = stores.length || 1;
  const surveyed = stores.filter((s) => s.stage !== "未調査").length;
  const contacted = stores.filter((s) =>
    CONTACTED_STAGES.includes(s.stage),
  ).length;
  const negotiating = stores.filter((s) =>
    NEGOTIATING_STAGES.includes(s.stage),
  ).length;
  const orders = stores.filter((s) => ORDERED_STAGES.includes(s.stage)).length;

  const funnel: FunnelStep[] = [
    { label: "登録", count: stores.length, rate: 100 },
    {
      label: "調査完了",
      count: surveyed,
      rate: pct(surveyed, stores.length),
    },
    { label: "接触", count: contacted, rate: pct(contacted, surveyed) },
    {
      label: "商談化",
      count: negotiating + orders,
      rate: pct(negotiating + orders, contacted),
    },
    {
      label: "受注",
      count: orders,
      rate: pct(orders, negotiating + orders),
    },
  ];

  const dmCount = stores.filter((s) => s.channel === "DM推奨").length;
  const telCount = stores.filter((s) => s.channel === "テレアポ推奨").length;
  const reqCount = stores.filter((s) => s.channel === "要確認").length;
  const undef = total - dmCount - telCount - reqCount;
  const channelBreakdown = [
    { channel: "DM推奨", count: dmCount, share: pct(dmCount, total) },
    { channel: "テレアポ推奨", count: telCount, share: pct(telCount, total) },
    { channel: "要確認", count: reqCount, share: pct(reqCount, total) },
    { channel: "未判定", count: undef, share: pct(undef, total) },
  ];

  // 提案商材別
  const counts = new Map<string, number>();
  for (const s of stores) {
    for (const svc of csvToList(s.target_service)) {
      counts.set(svc, (counts.get(svc) ?? 0) + 1);
    }
  }
  const serviceBreakdown = SERVICE_OPTIONS.map((svc) => ({
    service: svc,
    count: counts.get(svc) ?? 0,
    share: pct(counts.get(svc) ?? 0, total),
  }));

  const totalRevenue = handoffs.reduce(
    (sum, h) => sum + (h.initial_fee || 0),
    0,
  );
  const monthlyRecurring = handoffs
    .filter((h) => h.status === "完了")
    .reduce((sum, h) => sum + (h.monthly_fee || 0), 0);

  return {
    funnel,
    channelBreakdown,
    serviceBreakdown,
    totalRevenue,
    monthlyRecurring,
  };
}

function pct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 100);
}
