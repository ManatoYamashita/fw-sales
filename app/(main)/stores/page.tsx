import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { ProgressFilterBar } from "./progress/_components/progress-filter-bar";
import { StoresTable } from "./_components/stores-table";
import { Spinner } from "@/components/ui/spinner";
import { getAllProfiles } from "@/lib/queries/profiles";
import { DEAL_STATUSES, type DealStatus } from "@/types/deal";
import type { SortDirection } from "@/types/store";
import { STAGE_IDS, type StageId } from "@/types/stage";
import { CHANNELS, type Channel } from "@/types/store";
import {
  CURRENT_SALES_STATES,
  DEFAULT_PROGRESS_SORT,
  NEXT_ACTION_URGENCIES,
  PROGRESS_SORT_KEYS,
  type CurrentSalesState,
  type NextActionUrgency,
  type ProgressSort,
  type ProgressSortKey,
  type SalesProgressFilter,
} from "@/lib/domain/sales-progress";

export const metadata: Metadata = { title: "店舗・営業一覧" };

type SearchParams = { q?: string; appt?: string; deal?: string; sales?: string; next?: string; state?: string; stage?: string; channel?: string; sort?: string; dir?: string };

function parseFilter(p: SearchParams): SalesProgressFilter {
  const filter: SalesProgressFilter = {};
  if (p.q) filter.q = p.q;
  if (p.appt === "acquired" || p.appt === "none") filter.appt = p.appt;
  if (p.deal === "none" || (p.deal && (DEAL_STATUSES as readonly string[]).includes(p.deal))) filter.deal = p.deal as DealStatus | "none";
  if (p.sales) filter.sales = p.sales;
  if (p.next && (NEXT_ACTION_URGENCIES as readonly string[]).includes(p.next)) filter.next = p.next as NextActionUrgency;
  if (p.state && (CURRENT_SALES_STATES as readonly string[]).includes(p.state)) filter.state = p.state as CurrentSalesState;
  if (p.stage && (STAGE_IDS as readonly string[]).includes(p.stage)) filter.stage = p.stage as StageId;
  if (p.channel && (CHANNELS as readonly string[]).includes(p.channel)) filter.channel = p.channel as Channel;
  return filter;
}

function parseSort(p: SearchParams): ProgressSort {
  if (!p.sort || !(PROGRESS_SORT_KEYS as readonly string[]).includes(p.sort)) return DEFAULT_PROGRESS_SORT;
  const dir: SortDirection = p.dir === "asc" ? "asc" : "desc";
  return { key: p.sort as ProgressSortKey, dir };
}

export default async function StoresPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const filter = parseFilter(sp);
  const sort = parseSort(sp);
  return <div className="space-y-4">
    <div className="flex items-center justify-between gap-2 flex-wrap">
      <div><h2 className="text-xl md:text-2xl font-bold text-foreground">店舗・営業一覧</h2><p className="text-sm text-muted-foreground">現在の営業状態と次に行うことを店舗単位で確認できます。</p></div>
      <Link href="/stores/new" className="inline-flex items-center gap-1.5 h-10 px-4 rounded-lg border border-transparent bg-primary text-primary-foreground text-sm font-medium hover:bg-background hover:text-foreground hover:border-foreground"><Plus className="h-4 w-4" />店舗を登録</Link>
    </div>
    <Suspense key={JSON.stringify({ filter, sort })} fallback={<div className="flex items-center gap-2 text-sm text-muted-foreground py-12 justify-center"><Spinner /> 読み込み中…</div>}>
      <StoresPageBody filter={filter} sort={sort} />
    </Suspense>
  </div>;
}

/**
 * `getAllProfiles` を Suspense 境界の内側に置くための data-fetching shell。
 * ProgressFilterBar (営業担当セレクト用) と StoresTable の両方が同じ profiles
 * 一覧を必要とするため、ここで 1 回だけ取得して両方へ渡す
 * (Low #E: cache key 分裂 / 二重 SELECT 防止、Low #F: ページシェル全体のブロック防止)。
 */
async function StoresPageBody({ filter, sort }: { filter: SalesProgressFilter; sort: ProgressSort }) {
  const profiles = await getAllProfiles({ excludePlaceholders: false });
  const profileEntries = profiles.map((p) => [p.id, p.display_name] as const);
  return <>
    <ProgressFilterBar profileEntries={profileEntries} />
    <StoresTable filter={filter} sort={sort} profiles={profiles} />
  </>;
}
