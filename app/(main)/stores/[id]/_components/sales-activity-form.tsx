"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { createDealAction, updateDealAction } from "@/lib/actions/deal-actions";
import { today } from "@/lib/utils/date";
import { DEAL_STATUSES, MEETING_TYPES, NEXT_ACTION_TYPES, type Deal } from "@/types/deal";
import type { Profile } from "@/types/profile";
import type { Store } from "@/types/store";

export function SalesActivityForm({ store, deal, profiles, onClose }: { store: Store; deal?: Deal; profiles: readonly Profile[]; onClose: () => void }) {
  const [status, setStatus] = useState(deal?.status ?? "初回接触");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const submit = (formData: FormData) => startTransition(async () => {
    const result = deal ? await updateDealAction(deal.id, null, formData) : await createDealAction(store.id, null, formData);
    if (!result.ok) return toast.error(result.error);
    toast.success(result.message ?? "保存しました");
    onClose();
    router.replace(`/stores/${store.id}?tab=progress&activity=${result.data.id}`);
    router.refresh();
  });
  return <form action={submit} className="rounded-xl border border-border bg-card p-4 space-y-4">
    <div className="flex items-center justify-between gap-2"><h3 className="font-semibold">{deal ? "営業記録を編集" : "営業記録を追加"}</h3><Button type="button" variant="ghost" size="sm" onClick={onClose}>閉じる</Button></div>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <FormField label="実施日" htmlFor={`date-${deal?.id ?? "new"}`} required><Input id={`date-${deal?.id ?? "new"}`} name="date" type="date" required defaultValue={deal?.date ?? today()} /></FormField>
      <FormField label="活動種別" htmlFor={`type-${deal?.id ?? "new"}`} required><Select id={`type-${deal?.id ?? "new"}`} name="meeting_type" defaultValue={deal?.meeting_type ?? "対面"}>{MEETING_TYPES.map((v) => <option key={v}>{v}</option>)}</Select></FormField>
      <FormField label="営業状態" htmlFor={`status-${deal?.id ?? "new"}`} required><Select id={`status-${deal?.id ?? "new"}`} name="status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>{DEAL_STATUSES.map((v) => <option key={v}>{v}</option>)}</Select></FormField>
      <FormField label="営業担当者" htmlFor={`sales-${deal?.id ?? "new"}`}><Select id={`sales-${deal?.id ?? "new"}`} name="assigned_sales_user_id" defaultValue={deal?.assigned_sales_user_id ?? store.assigned_sales_user_id ?? ""}><option value="">未割当</option>{profiles.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}</Select></FormField>
      <FormField label="営業メモ" htmlFor={`memo-${deal?.id ?? "new"}`} hint="この日に行ったことを記録します（最大5000文字）" className="md:col-span-2"><Textarea id={`memo-${deal?.id ?? "new"}`} name="activity_memo" rows={4} maxLength={5000} defaultValue={deal?.activity_memo ?? ""} /></FormField>
      <FormField label="提案内容" htmlFor={`proposal-${deal?.id ?? "new"}`} className="md:col-span-2"><Textarea id={`proposal-${deal?.id ?? "new"}`} name="proposal" rows={3} defaultValue={deal?.proposal ?? ""} /></FormField>
      <FormField label="ヒアリング・打ち合わせ内容" htmlFor={`discussion-${deal?.id ?? "new"}`} className="md:col-span-2"><Textarea id={`discussion-${deal?.id ?? "new"}`} name="discussion" rows={4} defaultValue={deal?.discussion ?? ""} /></FormField>
      <FormField label="見積金額" htmlFor={`estimate-${deal?.id ?? "new"}`}><Input id={`estimate-${deal?.id ?? "new"}`} name="estimate_amount" type="number" min={0} step={1} defaultValue={deal?.estimate_amount ?? 0} /></FormField>
      {status === "受注" ? <FormField label="受注金額" htmlFor={`order-${deal?.id ?? "new"}`}><Input id={`order-${deal?.id ?? "new"}`} name="order_amount" type="number" min={0} step={1} defaultValue={deal?.order_amount ?? ""} /></FormField> : null}
      {status === "失注" ? <FormField label="失注理由" htmlFor={`lost-${deal?.id ?? "new"}`} className="md:col-span-2"><Textarea id={`lost-${deal?.id ?? "new"}`} name="lost_reason" rows={3} defaultValue={deal?.lost_reason ?? ""} /></FormField> : null}
      <div className="md:col-span-2 border-t border-border pt-4"><h4 className="text-sm font-semibold">この記録時点の次回アクション</h4><p className="text-xs text-muted-foreground">日付・種別・内容はそれぞれ単独でも保存できます。</p></div>
      <FormField label="次回アクション予定日" htmlFor={`next-date-${deal?.id ?? "new"}`}><Input id={`next-date-${deal?.id ?? "new"}`} name="next_action_date" type="date" defaultValue={deal?.next_action_date ?? ""} /></FormField>
      <FormField label="次回アクション種別" htmlFor={`next-type-${deal?.id ?? "new"}`}><Select id={`next-type-${deal?.id ?? "new"}`} name="next_action_type" defaultValue={deal?.next_action_type ?? ""}><option value="">未設定</option>{NEXT_ACTION_TYPES.map((v) => <option key={v}>{v}</option>)}</Select></FormField>
      <FormField label="次回アクション内容" htmlFor={`next-note-${deal?.id ?? "new"}`} hint="最大500文字" className="md:col-span-2"><Textarea id={`next-note-${deal?.id ?? "new"}`} name="next_action_note" rows={3} maxLength={500} defaultValue={deal?.next_action_note ?? ""} /></FormField>
    </div>
    <div className="flex justify-end"><Button type="submit" variant="primary" disabled={pending}>{pending ? "保存中…" : deal ? "変更を保存" : "営業記録を追加"}</Button></div>
  </form>;
}
