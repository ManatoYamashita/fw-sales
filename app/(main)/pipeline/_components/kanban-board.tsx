import Link from "next/link";
import { cacheLife, cacheTag } from "next/cache";
import { ChannelBadge } from "@/components/feature/channel-badge";
import { getPipelineColumns } from "@/lib/queries/pipeline";
import { getAllProfiles } from "@/lib/queries/profiles";
import { CACHE_TAGS } from "@/lib/cache";
import { cn } from "@/lib/utils/cn";
import type { Store, StoreFilter } from "@/types/store";
import type { StageId } from "@/types/stage";

async function loadColumns(filter: StoreFilter) {
  "use cache";
  cacheLife("longBackstop");
  cacheTag(CACHE_TAGS.stores, CACHE_TAGS.pipeline);
  return getPipelineColumns(filter);
}

export async function KanbanBoard({ filter }: { filter: StoreFilter }) {
  const [columns, profiles] = await Promise.all([
    loadColumns(filter),
    getAllProfiles({ excludePlaceholders: false }),
  ]);
  // Phase 7: 営業担当の表示は profile.display_name を id 経由で解決する。
  const profileNameById = new Map(profiles.map((p) => [p.id, p.display_name]));
  return (
    // 画面幅ではなくボードの利用可能幅で、縦積みと横並びを切り替える。
    <div className="@container min-w-0">
      <div className="flex min-w-0 flex-col gap-3 pb-4 @min-[700px]:flex-row @min-[700px]:overflow-x-auto">
        {columns.map((col) => (
          <Column key={col.id} column={col} profileNameById={profileNameById} />
        ))}
      </div>
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
  profileNameById: Map<string, string>;
}

function Column({ column, profileNameById }: ColumnProps) {
  return (
    <section
      aria-label={`${column.label} カラム`}
      className={cn(
        "flex w-full min-w-0 flex-col rounded-lg border border-border bg-card",
        "@min-[700px]:max-h-[calc(100dvh-220px)] @min-[700px]:w-72 @min-[700px]:shrink-0",
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
      <div className="flex-1 space-y-2 p-2 @min-[700px]:overflow-y-auto">
        {column.stores.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-6">
            該当なし
          </p>
        ) : (
          column.stores.map((store) => (
            <KanbanCard
              key={store.id}
              store={store}
              profileNameById={profileNameById}
            />
          ))
        )}
      </div>
    </section>
  );
}

function KanbanCard({
  store,
  profileNameById,
}: {
  store: Store;
  profileNameById: Map<string, string>;
}) {
  // Phase 7: user_id → display_name に解決して表示。未割当 / 解決失敗時は省略。
  const assignedSalesName = store.assigned_sales_user_id
    ? (profileNameById.get(store.assigned_sales_user_id) ?? null)
    : null;
  return (
    <Link
      href={`/stores/${store.id}`}
      className="block bg-card text-card-foreground rounded-md border border-border p-2.5 shadow-xs hover:shadow-card hover:border-ring/40 hover:-translate-y-px transition-[box-shadow,border-color,transform]"
    >
      <p className="text-sm font-semibold text-foreground line-clamp-2 leading-snug">
        {store.name}
      </p>
      <p className="text-xs text-muted-foreground mt-1 truncate">
        {[store.prefecture, store.city].filter(Boolean).join(" / ")}
      </p>
      <div className="flex items-center justify-between mt-2 gap-2">
        <ChannelBadge channel={store.channel} />
        {assignedSalesName ? (
          <span className="text-xs text-muted-foreground">
            {assignedSalesName}
          </span>
        ) : null}
      </div>
    </Link>
  );
}
