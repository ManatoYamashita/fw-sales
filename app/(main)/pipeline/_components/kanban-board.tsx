import Link from "next/link";
import { cacheTag } from "next/cache";
import { ChannelBadge } from "@/components/feature/channel-badge";
import { PriorityBadge } from "@/components/feature/priority-badge";
import { getPipelineColumns } from "@/lib/queries/pipeline";
import { CACHE_TAGS } from "@/lib/cache";
import type { Store, StoreFilter } from "@/types/store";
import type { StageId } from "@/types/stage";

async function loadColumns(filter: StoreFilter) {
  "use cache";
  cacheTag(CACHE_TAGS.stores, CACHE_TAGS.pipeline);
  return getPipelineColumns(filter);
}

export async function KanbanBoard({ filter }: { filter: StoreFilter }) {
  const columns = await loadColumns(filter);
  return (
    <div className="flex gap-3 overflow-x-auto pb-4 -mx-4 md:-mx-6 px-4 md:px-6">
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
      className="w-72 shrink-0 rounded-lg bg-slate-100/70 border border-slate-200 flex flex-col max-h-[calc(100dvh-220px)]"
    >
      <header className="flex items-center justify-between px-3 py-2 border-b border-slate-200">
        <span
          className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold"
          style={{ background: column.bg, color: column.color }}
        >
          {column.label}
        </span>
        <span className="text-xs font-semibold text-slate-600 tabular-nums">
          {column.stores.length}
        </span>
      </header>
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {column.stores.length === 0 ? (
          <p className="text-xs text-slate-400 text-center py-6">
            該当なし
          </p>
        ) : (
          column.stores.map((store) => <Card key={store.id} store={store} />)
        )}
      </div>
    </section>
  );
}

function Card({ store }: { store: Store }) {
  return (
    <Link
      href={`/stores/${store.id}`}
      className="block bg-white rounded-md border border-slate-200 p-2.5 shadow-sm hover:shadow-card hover:border-slate-300 transition"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-slate-900 line-clamp-2">
          {store.name}
        </p>
        <PriorityBadge priority={store.priority} />
      </div>
      <p className="text-xs text-slate-500 mt-1 truncate">
        {[store.prefecture, store.city].filter(Boolean).join(" / ")}
      </p>
      <div className="flex items-center justify-between mt-2 gap-2">
        <ChannelBadge channel={store.channel} />
        {store.assigned_sales ? (
          <span className="text-xs text-slate-500">{store.assigned_sales}</span>
        ) : null}
      </div>
    </Link>
  );
}
