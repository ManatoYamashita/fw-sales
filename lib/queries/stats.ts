import "server-only";
import { repos } from "@/lib/repositories";
import { CONTACTED_STAGES } from "@/lib/domain/stages";
import { NAV_ITEMS } from "@/lib/domain/nav";
import { getResearchReviewCount } from "@/lib/queries/research";

export interface DashboardStats {
  total: number;
  surveyed: number;
  waitResearch: number;
  dm: number;
  tel: number;
  contacted: number;
  totalRevenue: number;
  monthlyRev: number;
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const [stores, handoffs] = await Promise.all([
    repos.store.list(),
    repos.handoff.list(),
  ]);

  const total = stores.length;
  const surveyed = stores.filter((s) => s.stage !== "未調査").length;
  const waitResearch = stores.filter((s) => s.stage === "未調査").length;
  const dm = stores.filter((s) => s.channel === "DM推奨").length;
  const tel = stores.filter((s) => s.channel === "テレアポ推奨").length;
  const contacted = stores.filter((s) =>
    CONTACTED_STAGES.includes(s.stage),
  ).length;

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

function enabledNavBadgeKeys(): Set<keyof NavBadgeCounts> {
  // disabled な menu のバッジは表示されないため、対応する list クエリも発火させない。
  // `NAV_ITEMS` を単一の真実として参照し、disable 解除時に自動的にバッジが復活する。
  return new Set(
    NAV_ITEMS.filter((item) => !item.disabled && item.badgeKey).map(
      (item) => item.badgeKey as keyof NavBadgeCounts,
    ),
  );
}

/** `'use cache'` で包んでよいバッジ件数 (research 以外)。 */
export type CacheableNavBadgeCounts = Omit<NavBadgeCounts, "research">;

/**
 * research 以外のバッジ件数。すべて stores / deals / handoffs タグで失効する
 * テーブルだけから数えるため、呼び出し側でキャッシュしてよい
 * (`components/layout/nav-badges.tsx`)。
 */
export async function getCacheableNavBadgeCounts(): Promise<CacheableNavBadgeCounts> {
  const enabledBadgeKeys = enabledNavBadgeKeys();
  const needsStores =
    enabledBadgeKeys.has("stores") || enabledBadgeKeys.has("pipeline");
  const needsDeals = enabledBadgeKeys.has("deals");
  const needsHandoffs = enabledBadgeKeys.has("handoffs");

  const [stores, deals, handoffs] = await Promise.all([
    needsStores ? repos.store.list() : Promise.resolve([] as Awaited<ReturnType<typeof repos.store.list>>),
    needsDeals ? repos.deal.list() : Promise.resolve([] as Awaited<ReturnType<typeof repos.deal.list>>),
    needsHandoffs ? repos.handoff.list() : Promise.resolve([] as Awaited<ReturnType<typeof repos.handoff.list>>),
  ]);

  return {
    stores: enabledBadgeKeys.has("stores") ? stores.length : 0,
    pipeline: enabledBadgeKeys.has("pipeline")
      ? stores.filter((s) => s.stage !== "架電済み").length
      : 0,
    deals: enabledBadgeKeys.has("deals")
      ? deals.filter((d) => d.status !== "失注" && d.status !== "受注").length
      : 0,
    handoffs: enabledBadgeKeys.has("handoffs")
      ? handoffs.filter((h) => h.status === "運用確認待ち").length
      : 0,
  };
}

/**
 * 「調査」バッジ = `/research` の「レビュー待ち」タブの件数 (#299)。
 *
 * #121 以降は `stage === "未調査"` を数えていたが、`/research` のタブは未レビューの
 * AI 調査結果を優先して分類するため、両者が食い違っていた。タブと同じ関数
 * (`getResearchReviewCount`) を通すことで一致を構造的に保証する。
 *
 * 未レビューかどうかは Vercel Workflow の step が書き込み、`revalidateTag` が
 * 効く経路に乗らないため、この件数は**キャッシュしない** (`getResearchQueue` と同じ扱い)。
 */
export async function getResearchNavBadgeCount(): Promise<number> {
  if (!enabledNavBadgeKeys().has("research")) return 0;
  return getResearchReviewCount();
}
