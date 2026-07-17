import { Suspense } from "react";
import type { Metadata } from "next";
import { StoresViewSwitch } from "../_components/stores-view-switch";
import { ProgressFilterBar } from "./_components/progress-filter-bar";
import { ProgressTable } from "./_components/progress-table";
import { Spinner } from "@/components/ui/spinner";
import { getAllProfiles } from "@/lib/queries/profiles";
import { DEAL_STATUSES, type DealStatus } from "@/types/deal";
import type { SortDirection } from "@/types/store";
import {
  DEFAULT_PROGRESS_SORT,
  NEXT_ACTION_URGENCIES,
  PROGRESS_SORT_KEYS,
  type NextActionUrgency,
  type ProgressSort,
  type ProgressSortKey,
  type SalesProgressFilter,
} from "@/lib/domain/sales-progress";

export const metadata: Metadata = {
  title: "営業進捗",
};

interface PageProps {
  searchParams: Promise<{
    q?: string;
    appt?: string;
    deal?: string;
    sales?: string;
    next?: string;
    sort?: string;
    dir?: string;
  }>;
}

function parseFilter(
  params: Awaited<PageProps["searchParams"]>,
): SalesProgressFilter {
  const filter: SalesProgressFilter = {};
  if (params.q) filter.q = params.q;
  if (params.appt === "acquired" || params.appt === "none") {
    filter.appt = params.appt;
  }
  if (
    params.deal &&
    (params.deal === "none" ||
      (DEAL_STATUSES as readonly string[]).includes(params.deal))
  ) {
    filter.deal = params.deal as DealStatus | "none";
  }
  if (params.sales) filter.sales = params.sales;
  if (
    params.next &&
    (NEXT_ACTION_URGENCIES as readonly string[]).includes(params.next)
  ) {
    filter.next = params.next as NextActionUrgency;
  }
  return filter;
}

function parseSort(params: Awaited<PageProps["searchParams"]>): ProgressSort {
  if (
    !params.sort ||
    !(PROGRESS_SORT_KEYS as readonly string[]).includes(params.sort)
  ) {
    return DEFAULT_PROGRESS_SORT;
  }
  // SortableHeader は dir 未指定を desc 扱いするため、表示と実ソートを揃える
  const dir: SortDirection = params.dir === "asc" ? "asc" : "desc";
  return { key: params.sort as ProgressSortKey, dir };
}

export default async function SalesProgressPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const filter = parseFilter(sp);
  const sort = parseSort(sp);
  const profiles = await getAllProfiles({ excludePlaceholders: false });
  const profileEntries = profiles.map((p) => [p.id, p.display_name] as const);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-xl md:text-2xl font-bold text-foreground">
          営業進捗
        </h2>
        <div className="flex items-center gap-2">
          <StoresViewSwitch active="progress" />
        </div>
      </div>

      <ProgressFilterBar profileEntries={profileEntries} />

      <Suspense
        key={JSON.stringify({ filter, sort })}
        fallback={
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-12 justify-center">
            <Spinner /> 読み込み中…
          </div>
        }
      >
        <ProgressTable filter={filter} sort={sort} />
      </Suspense>
    </div>
  );
}
