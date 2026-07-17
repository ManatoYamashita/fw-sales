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
import { updateSalesProgressAction } from "@/lib/actions/store-actions";
import { formatDate, todayInTimeZone } from "@/lib/utils/date";
import {
  compareDealsNewestFirst,
  getNextActionUrgency,
  NEXT_ACTION_URGENCY_LABELS,
  pickLatestDeal,
  type NextActionUrgency,
} from "@/lib/domain/sales-progress";
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

  const latestDeal = pickLatestDeal(deals);
  const recentDeals = [...deals]
    .sort(compareDealsNewestFirst)
    .slice(0, RECENT_DEALS_LIMIT);
  const urgency = getNextActionUrgency(
    store.next_action_date,
    todayInTimeZone("Asia/Tokyo"),
  );

  const onCancel = () => {
    setAppointmentDate(store.appointment_acquired_date ?? "");
    setNextActionDate(store.next_action_date ?? "");
    setNextActionNote(store.next_action_note ?? "");
    setEditing(false);
  };

  const onSave = () => {
    startTransition(async () => {
      const formData = new FormData();
      // 空文字は Action 側で null に正規化される (= フィールドのクリア)
      formData.set("appointment_acquired_date", appointmentDate);
      formData.set("next_action_date", nextActionDate);
      formData.set("next_action_note", nextActionNote);
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
                  商談を開く
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

          {recentDeals.length > 0 ? (
            <ul className="space-y-1.5" aria-label="商談履歴">
              {recentDeals.map((deal) => (
                <li key={deal.id}>
                  <Link
                    href={`/deals/${deal.id}`}
                    className="flex items-center gap-3 rounded-md px-2 py-1.5 -mx-2 text-sm hover:bg-muted/50 transition-colors"
                  >
                    <span className="text-muted-foreground tabular-nums whitespace-nowrap">
                      {formatDate(deal.date)}
                    </span>
                    <span className="text-foreground/80">{deal.meeting_type}</span>
                    <DealStatusBadge status={deal.status} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </Card.Body>
    </Card>
  );
}
