import Link from "next/link";
import { cacheTag } from "next/cache";
import { connection } from "next/server";
import { ChannelBadge } from "@/components/feature/channel-badge";
import { PriorityBadge } from "@/components/feature/priority-badge";
import { getPipelineColumns } from "@/lib/queries/pipeline";
import { CACHE_TAGS } from "@/lib/cache";
import { cn } from "@/lib/utils/cn";
import type { Store, StoreFilter } from "@/types/store";
import type { StageId } from "@/types/stage";

async function loadColumns(filter: StoreFilter) {
  "use cache";
  cacheTag(CACHE_TAGS.stores, CACHE_TAGS.pipeline);
  return getPipelineColumns(filter);
}

export async function KanbanBoard({ filter }: { filter: StoreFilter }) {
  // build 時 prerender を skip (USE_CACHE_TIMEOUT 対策)。
  await connection();
  const columns = await loadColumns(filter);
  return (
    <div className="flex gap-3 overflow-x-auto pb-4 -mx-4 md:-mx-6 px-4 md:px-6 scrollbar-none">
      {columns.map((col) => (
        <Column key={col.id} column={col} />
      ))}
    </div>
  );
}

interface ColumnProps {
  column: {
    id: StageId;
    label: string;
    color: string;
    bg: string;
    stores: Store[];
  };
}

function Column({ column }: ColumnProps) {
  return (
    <section
      aria-label={`${column.label} カラム`}
      className={cn(
        "w-72 shrink-0 rounded-lg bg-card border border-border flex flex-col",
        "max-h-[calc(100dvh-220px)]",
      )}
      data-stage={column.id}
    >
      <header className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-stage text-stage-foreground">
          {column.label}
        </span>
        <span className="text-xs font-semibold text-muted-foreground tabular-nums">
          {column.stores.length}
        </span>
      </header>
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {column.stores.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-6">
            該当なし
          </p>
        ) : (
          column.stores.map((store) => <KanbanCard key={store.id} store={store} />)
        )}
      </div>
    </section>
  );
}

function KanbanCard({ store }: { store: Store }) {
  return (
    <Link
      href={`/stores/${store.id}`}
      className="block bg-card text-card-foreground rounded-md border border-border p-2.5 shadow-xs hover:shadow-card hover:border-ring/40 hover:-translate-y-px transition-[box-shadow,border-color,transform]"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-foreground line-clamp-2 leading-snug">
          {store.name}
        </p>
        <PriorityBadge priority={store.priority} />
      </div>
      <p className="text-xs text-muted-foreground mt-1 truncate">
        {[store.prefecture, store.city].filter(Boolean).join(" / ")}
      </p>
      <div className="flex items-center justify-between mt-2 gap-2">
        <ChannelBadge channel={store.channel} />
        {store.assigned_sales ? (
          <span className="text-xs text-muted-foreground">
            {store.assigned_sales}
          </span>
        ) : null}
      </div>
    </Link>
  );
}
