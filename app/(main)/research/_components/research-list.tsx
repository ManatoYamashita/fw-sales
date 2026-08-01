import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Search, CheckCircle2, ClipboardCheck } from "lucide-react";
import { findStage } from "@/types/stage";
import type { Store } from "@/types/store";

export function NeedsReviewList({ stores }: { stores: Store[] }) {
  if (stores.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<CheckCircle2 />}
          title="要確認の調査結果はありません"
          description="AI店舗調査が完了すると、レビュー待ちの店舗がここに表示されます。"
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
              <Badge tone="warning" className="whitespace-nowrap">
                <ClipboardCheck className="h-3 w-3" />
                レビューする
              </Badge>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

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

export function DoneList({ stores }: { stores: Store[] }) {
  if (stores.length === 0) {
    return (
      <Card>
        <EmptyState
          title="調査済みの店舗はまだありません"
          description="AI店舗調査のレビューを完了すると、ここに表示されます。"
        />
      </Card>
    );
  }
  return (
    <Card>
      <ul className="divide-y divide-border/60">
        {stores.map((s) => {
          const stage = findStage(s.stage);
          return (
            <li key={s.id}>
              <Link
                href={`/research/${s.id}`}
                className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-muted/40 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground">
                    {s.name}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {[s.prefecture, s.city, s.genre].filter(Boolean).join(" / ")}
                  </p>
                </div>
                {stage ? (
                  <span
                    className="inline-flex h-6 items-center px-2.5 rounded-full text-xs font-medium"
                    style={{ color: stage.color, backgroundColor: stage.bg }}
                  >
                    {stage.label}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
