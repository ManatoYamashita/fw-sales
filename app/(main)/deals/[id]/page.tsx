import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { connection } from "next/server";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DealStatusForm } from "./_components/deal-status-form";
import { getDealCached } from "@/lib/queries/deals";
import { getStoreCached } from "@/lib/queries/stores";
import { getProfileById } from "@/lib/queries/profiles";
import { formatDate } from "@/lib/utils/date";
import { formatYen } from "@/lib/utils/format";
import type { DealStatus } from "@/types/deal";
import { ArrowLeftRight } from "lucide-react";

type Params = Promise<{ id: string }>;

const statusTone: Record<DealStatus, "neutral" | "amber" | "green" | "red"> = {
  継続追客: "neutral",
  見積提出: "amber",
  受注: "green",
  失注: "red",
};

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { id } = await params;
  const deal = await getDealCached(id);
  return { title: deal ? `${deal.store_name} の商談` : "商談" };
}

export default async function DealDetailPage({
  params,
}: {
  params: Params;
}) {
  // build 時 prerender を skip (USE_CACHE_TIMEOUT 対策)。
  await connection();
  const { id } = await params;
  const deal = await getDealCached(id);
  if (!deal) notFound();
  // Phase 8: assigned_sales (text) DROP 済。user_id → display_name に解決。
  const [store, assignedSalesProfile] = await Promise.all([
    getStoreCached(deal.store_id),
    deal.assigned_sales_user_id
      ? getProfileById(deal.assigned_sales_user_id)
      : Promise.resolve(null),
  ]);
  const assignedSalesName = assignedSalesProfile?.display_name ?? "—";

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <Link
            href="/deals"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            ← 商談一覧
          </Link>
          <h2 className="text-xl md:text-2xl font-bold text-foreground mt-1">
            {deal.store_name}
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {formatDate(deal.date)} / {deal.meeting_type} / 担当{" "}
            {assignedSalesName}
          </p>
        </div>
        <Badge tone={statusTone[deal.status]}>{deal.status}</Badge>
      </div>

      {deal.status === "受注" ? (
        <Card>
          <Card.Body className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-green-700">
                受注金額 {formatYen(deal.order_amount)}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                運用への引き継ぎを作成しましょう。
              </p>
            </div>
            <Link
              href={`/handoffs/new?deal=${deal.id}`}
              className="inline-flex items-center gap-1 h-9 px-3 rounded-md text-sm bg-primary text-primary-foreground"
            >
              <ArrowLeftRight className="h-4 w-4" />
              引き継ぎを作成
            </Link>
          </Card.Body>
        </Card>
      ) : null}

      <Card>
        <Card.Header>
          <Card.Title>店舗</Card.Title>
        </Card.Header>
        <Card.Body className="text-sm">
          {store ? (
            <Link
              href={`/stores/${store.id}`}
              className="text-blue-700 hover:text-blue-800 font-medium"
            >
              {store.name} ({store.prefecture} {store.city})
            </Link>
          ) : (
            <span className="text-muted-foreground/70">削除済み</span>
          )}
        </Card.Body>
      </Card>

      <DealStatusForm deal={deal} />
    </div>
  );
}
