import Link from "next/link";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ChannelBadge } from "@/components/feature/channel-badge";
import { Search, CheckCircle2 } from "lucide-react";
import { formatDate } from "@/lib/utils/date";
import type { Store } from "@/types/store";
import type { Research } from "@/types/research";

export function WaitingList({ stores }: { stores: Store[] }) {
  if (stores.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<CheckCircle2 />}
          title="調査待ちはありません"
          description="新しい店舗を登録すると、ここに自動で並びます。"
        />
      </Card>
    );
  }
  return (
    <Card>
      <ul className="divide-y divide-border/60">
        {stores.map((s) => (
          <li key={s.id}>
            <Link
              href={`/research/${s.id}`}
              className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-muted/40 transition-colors"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">{s.name}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {[s.prefecture, s.city, s.genre].filter(Boolean).join(" / ")}
                </p>
              </div>
              <span className="inline-flex h-9 items-center gap-1 px-3 rounded-md text-xs font-medium bg-primary text-primary-foreground">
                <Search className="h-3.5 w-3.5" />
                調査開始
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function DoneList({
  rows,
}: {
  rows: Array<{ store: Store; research: Research }>;
}) {
  if (rows.length === 0) {
    return (
      <Card>
        <EmptyState
          title="完了した調査はまだありません"
          description="調査待ちタブから着手してください。"
        />
      </Card>
    );
  }
  return (
    <Card>
      <ul className="divide-y divide-border/60">
        {rows.map(({ store, research }) => (
          <li key={research.id}>
            <Link
              href={`/research/${store.id}`}
              className="flex items-start justify-between gap-3 px-5 py-3 hover:bg-muted/40 transition-colors"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">
                  {store.name}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                  {research.sales_hook || research.total_review}
                </p>
                <p className="text-xs text-muted-foreground/70 mt-1">
                  調査者 {research.researcher} ・{" "}
                  {formatDate(research.updated_at)}
                </p>
              </div>
              <ChannelBadge channel={research.channel} />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
