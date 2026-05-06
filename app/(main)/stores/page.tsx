import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { StoresFilterBar } from "./_components/stores-filter-bar";
import { StoresTable } from "./_components/stores-table";
import { Spinner } from "@/components/ui/spinner";
import { STAGE_IDS, type StageId } from "@/types/stage";
import {
  CHANNELS,
  DEFAULT_STORE_SORT,
  PRIORITIES,
  SORT_KEYS,
  type Channel,
  type Priority,
  type SortDirection,
  type StoreFilter,
  type StoreSort,
  type StoreSortKey,
} from "@/types/store";

export const metadata: Metadata = {
  title: "店舗一覧",
};

interface PageProps {
  searchParams: Promise<{
    q?: string;
    stage?: string;
    channel?: string;
    priority?: string;
    sort?: string;
    dir?: string;
  }>;
}

function parseFilter(params: Awaited<PageProps["searchParams"]>): StoreFilter {
  const filter: StoreFilter = {};
  if (params.q) filter.q = params.q;
  if (params.stage && (STAGE_IDS as readonly string[]).includes(params.stage)) {
    filter.stage = params.stage as StageId;
  }
  if (
    params.channel &&
    (CHANNELS as readonly string[]).includes(params.channel)
  ) {
    filter.channel = params.channel as Channel;
  }
  if (
    params.priority &&
    (PRIORITIES as readonly string[]).includes(params.priority)
  ) {
    filter.priority = params.priority as Priority;
  }
  return filter;
}

function parseSort(params: Awaited<PageProps["searchParams"]>): StoreSort {
  const key =
    params.sort && (SORT_KEYS as readonly string[]).includes(params.sort)
      ? (params.sort as StoreSortKey)
      : DEFAULT_STORE_SORT.key;
  const dir: SortDirection = params.dir === "asc" ? "asc" : "desc";
  return { key, dir };
}

export default async function StoresPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const filter = parseFilter(sp);
  const sort = parseSort(sp);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-xl md:text-2xl font-bold text-foreground">店舗一覧</h2>
        <Link
          href="/stores/new"
          className="inline-flex items-center gap-1.5 h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-secondary transition-colors"
        >
          <Plus className="h-4 w-4" />
          店舗を登録
        </Link>
      </div>

      <StoresFilterBar />

      <Suspense
        key={JSON.stringify({ filter, sort })}
        fallback={
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-12 justify-center">
            <Spinner /> 読み込み中…
          </div>
        }
      >
        <StoresTable filter={filter} sort={sort} />
      </Suspense>
    </div>
  );
}
