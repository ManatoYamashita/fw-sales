import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { DealStatusBadge } from "@/components/feature/deal-status-badge";
import { DealStatusForm } from "./_components/deal-status-form";
import { getDealCached, listDealsByStoreCached } from "@/lib/queries/deals";
import { getStoreCached } from "@/lib/queries/stores";
import { getProfileById } from "@/lib/queries/profiles";
import { formatDate } from "@/lib/utils/date";
import { formatYen } from "@/lib/utils/format";
import { Badge } from "@/components/ui/badge";
import { SalesStateBadge } from "@/components/feature/sales-state-badge";
import { deriveCurrentSalesState, getNextActionUrgency, NEXT_ACTION_URGENCY_LABELS, pickLatestDeal } from "@/lib/domain/sales-progress";
import { todayInTimeZone } from "@/lib/utils/date";

type Params = Promise<{ id: string }>;

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
  const { id } = await params;
  const deal = await getDealCached(id);
  if (!deal) notFound();
  // Phase 8: assigned_sales (text) DROP 済。user_id → display_name に解決。
  const [store, assignedSalesProfile, storeDeals] = await Promise.all([
    getStoreCached(deal.store_id),
    deal.assigned_sales_user_id
      ? getProfileById(deal.assigned_sales_user_id)
      : Promise.resolve(null),
    listDealsByStoreCached(deal.store_id),
  ]);
  const assignedSalesName = assignedSalesProfile?.display_name ?? "—";
  const latestDeal = pickLatestDeal(storeDeals);
  const urgency = store ? getNextActionUrgency(store.next_action_date, todayInTimeZone("Asia/Tokyo")) : "unset";

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
        <DealStatusBadge status={deal.status} />
      </div>

      {deal.status === "受注" ? (
        <Card>
          <Card.Body>
            <p className="text-sm font-semibold text-foreground">
              受注金額 {formatYen(deal.order_amount)}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              引き継ぎ機能は準備中です。
            </p>
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

      {store ? <Card>
        <Card.Header><Card.Title>顧客の現在状況</Card.Title></Card.Header>
        <Card.Body className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2"><SalesStateBadge state={deriveCurrentSalesState(store, latestDeal)} /><Badge tone={urgency === "overdue" ? "destructive" : urgency === "today" ? "warning" : urgency === "upcoming" ? "info" : "outline"}>{NEXT_ACTION_URGENCY_LABELS[urgency]}</Badge></div>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3"><div><dt className="text-xs text-muted-foreground">アポ取得日</dt><dd>{store.appointment_acquired_date ? formatDate(store.appointment_acquired_date) : "未取得"}</dd></div><div><dt className="text-xs text-muted-foreground">次回アクション予定日</dt><dd>{store.next_action_date ? formatDate(store.next_action_date) : "未設定"}</dd></div><div className="sm:col-span-2"><dt className="text-xs text-muted-foreground">次回アクション内容</dt><dd className="whitespace-pre-wrap break-words">{store.next_action_note || "未設定"}</dd></div><div className="sm:col-span-2"><dt className="text-xs text-muted-foreground">営業メモ</dt><dd className="line-clamp-3 whitespace-pre-wrap break-words">{store.memo || "未設定"}</dd></div></dl>
          <Link href={`/stores/${store.id}?tab=progress`} className="inline-flex font-medium text-primary hover:underline">店舗の営業進捗を開く</Link>
        </Card.Body>
      </Card> : null}

      <DealStatusForm deal={deal} />
    </div>
  );
}
