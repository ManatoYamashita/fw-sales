import Link from "next/link";
import { cacheTag } from "next/cache";
import { connection } from "next/server";
import { Handshake } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { repos } from "@/lib/repositories";
import { CACHE_TAGS } from "@/lib/cache";
import { formatDate } from "@/lib/utils/date";
import { formatYen } from "@/lib/utils/format";
import type { DealStatus } from "@/types/deal";

async function loadDealsByStore(storeId: string) {
  "use cache";
  cacheTag(CACHE_TAGS.dealsByStore(storeId), CACHE_TAGS.deals);
  return repos.deal.list(storeId);
}

const statusTone: Record<DealStatus, "neutral" | "amber" | "green" | "red"> = {
  継続追客: "neutral",
  見積提出: "amber",
  受注: "green",
  失注: "red",
};

export async function DealsHistoryCard({ storeId }: { storeId: string }) {
  // build 時 prerender を skip (USE_CACHE_TIMEOUT 対策)。
  await connection();
  const deals = await loadDealsByStore(storeId);
  return (
    <Card>
      <Card.Header>
        <Card.Title>商談履歴</Card.Title>
        <span className="text-xs text-muted-foreground">{deals.length} 件</span>
      </Card.Header>
      {deals.length === 0 ? (
        <Card.Body>
          <EmptyState
            icon={<Handshake />}
            title="商談はまだありません"
            description="商談メニューから新規商談を作成してください。"
          />
        </Card.Body>
      ) : (
        <ul className="divide-y divide-border/60">
          {deals.map((deal) => (
            <li key={deal.id}>
              <Link
                href={`/deals/${deal.id}`}
                className="block px-5 py-3 hover:bg-muted/40 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-foreground">
                    {formatDate(deal.date)} / {deal.meeting_type}
                  </span>
                  <Badge tone={statusTone[deal.status]}>{deal.status}</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                  {deal.proposal || deal.discussion || "—"}
                </p>
                <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                  <span>見積 {formatYen(deal.estimate_amount)}</span>
                  {deal.order_amount ? (
                    <span className="text-green-700 font-semibold">
                      受注 {formatYen(deal.order_amount)}
                    </span>
                  ) : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
