"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Save, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { toast } from "@/components/ui/toast";
import { DealStatusBadge } from "@/components/feature/deal-status-badge";
import { SalesStateBadge } from "@/components/feature/sales-state-badge";
import { updateSalesProgressAction } from "@/lib/actions/store-actions";
import { formatDate, todayInTimeZone } from "@/lib/utils/date";
import {
  compareDealsNewestFirst,
  deriveCurrentSalesState,
  getNextActionUrgency,
  NEXT_ACTION_URGENCY_LABELS,
  pickLatestDeal,
  type NextActionUrgency,
} from "@/lib/domain/sales-progress";
import { formatYen } from "@/lib/utils/format";
import type { Deal } from "@/types/deal";
import type { Store } from "@/types/store";

const URGENCY_TONE: Record<
  Exclude<NextActionUrgency, "unset">,
  "destructive" | "warning" | "info"
> = {
  overdue: "destructive",
  today: "warning",
  upcoming: "info",
};

/** 商談履歴の表示上限。全履歴は商談詳細 (`/deals/{id}`) 側で辿る。 */
const RECENT_DEALS_LIMIT = 5;

/**
 * 店舗詳細の営業進捗セクション (customer-sales-progress-management)。
 *
 * - アポ取得日 / 次回アクション予定日 / 次回アクション内容を顧客レベルで編集する
 * - 最新商談ステータス・商談履歴は表示とリンクのみ (編集は商談詳細画面の責務)
 */
export function SalesProgressCard({
  store,
  deals,
}: {
  store: Store;
  deals: readonly Deal[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [appointmentDate, setAppointmentDate] = useState(
    store.appointment_acquired_date ?? "",
  );
  const [nextActionDate, setNextActionDate] = useState(
    store.next_action_date ?? "",
  );
  const [nextActionNote, setNextActionNote] = useState(
    store.next_action_note ?? "",
  );
  const [memo, setMemo] = useState(store.memo);

  const latestDeal = pickLatestDeal(deals);
  const recentDeals = [...deals]
    .sort(compareDealsNewestFirst)
    .filter((deal) => deal.id !== latestDeal?.id)
    .slice(0, RECENT_DEALS_LIMIT);
  const currentSalesState = deriveCurrentSalesState(store, latestDeal);
  const urgency = getNextActionUrgency(
    store.next_action_date,
    todayInTimeZone("Asia/Tokyo"),
  );

  const onCancel = () => {
    setAppointmentDate(store.appointment_acquired_date ?? "");
    setNextActionDate(store.next_action_date ?? "");
    setNextActionNote(store.next_action_note ?? "");
    setMemo(store.memo);
    setEditing(false);
  };

  const onSave = () => {
    startTransition(async () => {
      const formData = new FormData();
      // 空文字は Action 側で null に正規化される (= フィールドのクリア)
      formData.set("appointment_acquired_date", appointmentDate);
      formData.set("next_action_date", nextActionDate);
      formData.set("next_action_note", nextActionNote);
      formData.set("memo", memo);
      const result = await updateSalesProgressAction(store.id, formData);
      if (result.ok) {
        toast.success(result.message ?? "更新しました");
        setEditing(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <Card>
      <Card.Header>
        <Card.Title>営業進捗</Card.Title>
        {editing ? (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onCancel}
              disabled={pending}
            >
              <X className="h-3.5 w-3.5" /> キャンセル
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={onSave}
              disabled={pending}
            >
              <Save className="h-3.5 w-3.5" />
              {pending ? "保存中…" : "保存"}
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setEditing(true)}
          >
            <Pencil className="h-3.5 w-3.5" /> 編集
          </Button>
        )}
      </Card.Header>
      <Card.Body className="space-y-5">
        {editing ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField
              label="アポ取得日"
              htmlFor="appointment_acquired_date"
              hint="未取得の場合は空のままにします"
            >
              <Input
                id="appointment_acquired_date"
                type="date"
                value={appointmentDate}
                onChange={(e) => setAppointmentDate(e.target.value)}
              />
            </FormField>
            <FormField label="営業メモ" htmlFor="sales_memo" hint={`${memo.length}/5000 文字。顧客について継続的に覚えておきたい情報`} className="sm:col-span-2">
              <Textarea id="sales_memo" rows={6} maxLength={5000} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="例: オーナーへの連絡は平日15時以降。前回の電話で予算時期を秋頃と伺った。" />
            </FormField>
            <FormField label="次回アクション予定日" htmlFor="next_action_date">
              <Input
                id="next_action_date"
                type="date"
                value={nextActionDate}
                onChange={(e) => setNextActionDate(e.target.value)}
              />
            </FormField>
            <FormField
              label="次回アクション内容"
              htmlFor="next_action_note"
              hint={`${nextActionNote.length}/500 文字`}
              className="sm:col-span-2"
            >
              <Textarea
                id="next_action_note"
                rows={3}
                maxLength={500}
                value={nextActionNote}
                onChange={(e) => setNextActionNote(e.target.value)}
                placeholder="例: 見積内容のフォロー電話。オーナーの予算感を再確認する。"
              />
            </FormField>
          </div>
        ) : (
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 text-sm">
            <div className="space-y-1"><dt className="text-xs font-semibold text-muted-foreground">現在の営業状態</dt><dd><SalesStateBadge state={currentSalesState} /></dd></div>
            <div className="space-y-1">
              <dt className="text-xs font-semibold text-muted-foreground">
                アポ取得
              </dt>
              <dd>
                {store.appointment_acquired_date ? (
                  <span className="inline-flex items-center gap-2">
                    <Badge tone="success">取得済み</Badge>
                    <span className="text-foreground/90 tabular-nums">
                      {formatDate(store.appointment_acquired_date)}
                    </span>
                  </span>
                ) : (
                  <Badge tone="outline">未取得</Badge>
                )}
              </dd>
            </div>
            <div className="space-y-1">
              <dt className="text-xs font-semibold text-muted-foreground">
                次回アクション
              </dt>
              <dd className="space-y-1">
                {store.next_action_date ? (
                  <span className="inline-flex items-center gap-2">
                    {urgency !== "unset" ? (
                      <Badge tone={URGENCY_TONE[urgency]}>
                        {NEXT_ACTION_URGENCY_LABELS[urgency]}
                      </Badge>
                    ) : null}
                    <span className="text-foreground/90 tabular-nums">
                      {formatDate(store.next_action_date)}
                    </span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">未設定</span>
                )}
                {store.next_action_note ? (
                  <p className="text-sm text-foreground whitespace-pre-wrap leading-6">
                    {store.next_action_note}
                  </p>
                ) : null}
              </dd>
            </div>
            <div className="space-y-1 sm:col-span-2"><dt className="text-xs font-semibold text-muted-foreground">営業メモ</dt><dd className="whitespace-pre-wrap break-words leading-6">{store.memo || <span className="text-muted-foreground">未設定</span>}</dd></div>
          </dl>
        )}

        {/* 最新商談 (表示のみ。編集は商談詳細画面) */}
        <div className="border-t border-border/60 pt-4 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-muted-foreground">
                最新商談
              </span>
              {latestDeal ? (
                <>
                  <DealStatusBadge status={latestDeal.status} />
                  <span className="text-xs text-muted-foreground tabular-nums">
                    最終商談日 {formatDate(latestDeal.date)}
                  </span>
                </>
              ) : (
                <span className="text-sm text-muted-foreground">商談なし</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {latestDeal ? (
                <Link
                  href={`/deals/${latestDeal.id}`}
                  className="text-sm font-medium text-primary hover:underline"
                >
                  商談を開く・編集する
                </Link>
              ) : null}
              <Link
                href={`/deals/new?store=${store.id}`}
                className="inline-flex items-center gap-1 h-8 px-3 rounded-md text-sm border border-border bg-card hover:bg-muted/40 text-foreground whitespace-nowrap"
              >
                <Plus className="h-3.5 w-3.5" /> 商談を登録
              </Link>
            </div>
          </div>

          {latestDeal ? <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-3 text-sm">
            <div className="flex flex-wrap gap-x-6 gap-y-2"><span>商談形式: {latestDeal.meeting_type}</span>{latestDeal.estimate_amount ? <span>見積金額: {formatYen(latestDeal.estimate_amount)}</span> : null}{(latestDeal.status === "受注" || latestDeal.order_amount !== null) ? <span>受注金額: {formatYen(latestDeal.order_amount)}</span> : null}</div>
            {latestDeal.proposal ? <section><h4 className="text-xs font-semibold text-muted-foreground">提案内容</h4><p className="whitespace-pre-wrap break-words leading-6">{latestDeal.proposal}</p></section> : null}
            {latestDeal.discussion ? <section><h4 className="text-xs font-semibold text-muted-foreground">ヒアリング・打ち合わせ内容</h4><p className="whitespace-pre-wrap break-words leading-6">{latestDeal.discussion}</p></section> : null}
            {(latestDeal.status === "失注" || latestDeal.lost_reason) && latestDeal.lost_reason ? <section><h4 className="text-xs font-semibold text-muted-foreground">失注理由</h4><p className="whitespace-pre-wrap break-words leading-6">{latestDeal.lost_reason}</p></section> : null}
          </div> : null}

          {recentDeals.length > 0 ? (
            <div className="space-y-2" aria-label="過去の商談履歴">
              {recentDeals.map((deal) => (
                <details key={deal.id} className="rounded-md border border-border px-3 py-2">
                  <summary className="cursor-pointer list-none flex items-center gap-3 text-sm">
                    <span className="text-muted-foreground tabular-nums whitespace-nowrap">
                      {formatDate(deal.date)}
                    </span>
                    <span className="text-foreground/80">{deal.meeting_type}</span>
                    <DealStatusBadge status={deal.status} />
                  </summary>
                  <div className="pt-3 pl-2 space-y-2 text-sm">{deal.proposal ? <p className="whitespace-pre-wrap break-words"><strong>提案内容:</strong> {deal.proposal}</p> : null}{deal.discussion ? <p className="whitespace-pre-wrap break-words"><strong>打ち合わせ内容:</strong> {deal.discussion}</p> : null}<p>見積金額: {formatYen(deal.estimate_amount)}</p>{deal.order_amount !== null ? <p>受注金額: {formatYen(deal.order_amount)}</p> : null}{deal.lost_reason ? <p className="whitespace-pre-wrap break-words"><strong>失注理由:</strong> {deal.lost_reason}</p> : null}<Link href={`/deals/${deal.id}`} className="font-medium text-primary hover:underline">商談詳細を開く</Link></div>
                </details>
              ))}
            </div>
          ) : null}
        </div>
      </Card.Body>
    </Card>
  );
}
