import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { ProgressFilterBar } from "./progress/_components/progress-filter-bar";
import { StoresTable } from "./_components/stores-table";
import {
  StoreQuickFilters,
  StoreQuickFiltersFallback,
} from "./_components/store-quick-filters";
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
    {/*
      クイックフィルタ (担当範囲 / 対応タイミング) は情報階層の最上段に置く。
      `useSearchParams` を読む Client Component は本番ビルドで Suspense 境界が必須
      なので独自の境界を張るが、**key は持たせない**。理由はフィルタバーと同じで、
      key 付きにするとフィルタ変更のたびに境界ごと作り直されてチップが一瞬消える。
      サーバデータには一切依存しないため、この境界はデータ取得を待たない。
    */}
    <Suspense fallback={<StoreQuickFiltersFallback />}>
      <StoreQuickFilters />
    </Suspense>

    {/*
      フィルタバーは **key を持たない** Suspense に置く。
      filter/sort ごとに key が変わる境界の内側に入れると、検索の debounce が URL を
      更新するたびに境界ごと作り直され、ProgressFilterBar ("use client") が
      再マウントされる。結果として絞り込みパネルの開閉状態 (useState) がリセットされ、
      バー自体も一瞬 fallback に置き換わる。
      key なし境界なら、ナビゲーションで再 suspend しても React は transition 中に
      fallback を出さず既存 DOM を保つため、入力体験が途切れない。
      あわせて getAllProfiles の await をページ本体から追い出し、ヘッダを即描画する。
    */}
    <Suspense fallback={<ProgressFilterBarFallback />}>
      <ProgressFilterBarSlot />
    </Suspense>

    {/* 一覧側は filter/sort ごとに fallback を出したいので key を維持する。 */}
    <Suspense key={JSON.stringify({ filter, sort })} fallback={<div className="flex items-center gap-2 text-sm text-muted-foreground py-12 justify-center"><Spinner /> 読み込み中…</div>}>
      <StoresTable filter={filter} sort={sort} />
    </Suspense>
  </div>;
}

/**
 * ProgressFilterBar に担当者選択肢を注入する data-fetching shell。
 *
 * `getAllProfiles` は `listSalesProgressRows` からも呼ばれるが、
 * **引数形状 (`{ excludePlaceholders: false }`) を必ず一致させる**こと。
 * 食い違うと `'use cache'` のキャッシュキーが割れ、コールド時に同じ SELECT が
 * 2 回走る。この一致は lib/queries/__tests__/sales-progress.test.ts で固定している。
 */
async function ProgressFilterBarSlot() {
  const profiles = await getAllProfiles({ excludePlaceholders: false });
  return <ProgressFilterBar profileEntries={profiles.map((p) => [p.id, p.display_name] as const)} />;
}

/**
 * ProgressFilterBar の骨格 fallback。
 *
 * 高さのマジックナンバーを置かず実 DOM と同じ flex 構造を写すことで、
 * 狭幅時に絞り込みボタンが 2 行目へ折り返すケースも含めてレイアウトシフトを避ける。
 * layout.tsx の SidebarFallback / TopbarFallback と同じく aria-hidden とし、
 * 一瞬で埋まるためスピナーは出さない。
 */
function ProgressFilterBarFallback() {
  return <div className="rounded-xl border border-border bg-card shadow-card" aria-hidden>
    <div className="flex items-stretch flex-wrap gap-2 p-2">
      <div className="h-11 flex-1 min-w-[180px] basis-full sm:basis-auto rounded-lg bg-muted/50" />
      <span className="hidden sm:block w-px self-stretch my-1 bg-border" />
      <div className="h-11 w-[116px] rounded-lg bg-muted/30" />
    </div>
  </div>;
}
