"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
import { formatYen } from "@/lib/utils/format";
import { compareDealsNewestFirst, deriveCurrentNextAction, deriveCurrentSalesState, getNextActionUrgency, NEXT_ACTION_URGENCY_LABELS, pickLatestDeal } from "@/lib/domain/sales-progress";
import type { Deal } from "@/types/deal";
import type { Profile } from "@/types/profile";
import type { Store } from "@/types/store";
import { SalesActivityForm } from "./sales-activity-form";

export function SalesProgressCard({ store, deals, profiles }: { store: Store; deals: readonly Deal[]; profiles: readonly Profile[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [editingCurrent, setEditingCurrent] = useState(false);
  const [appointmentDate, setAppointmentDate] = useState(store.appointment_acquired_date ?? "");
  const [memo, setMemo] = useState(store.memo);
  const [pending, startTransition] = useTransition();
  const [formTarget, setFormTarget] = useState<string | "new" | null>(() => searchParams.get("action") === "new" ? "new" : searchParams.get("activity"));
  const sorted = [...deals].sort(compareDealsNewestFirst);
  const latest = pickLatestDeal(deals);
  const history = sorted.filter((d) => d.id !== latest?.id);
  const currentNext = deriveCurrentNextAction(store, latest);
  const urgency = getNextActionUrgency(currentNext.date, todayInTimeZone("Asia/Tokyo"));
  const profileMap = new Map(profiles.map((p) => [p.id, p.display_name]));
  const closeForm = () => { setFormTarget(null); router.replace(`/stores/${store.id}?tab=progress`); };
  const saveCurrent = () => startTransition(async () => {
    const data = new FormData(); data.set("appointment_acquired_date", appointmentDate); data.set("memo", memo);
    const result = await updateSalesProgressAction(store.id, data);
    if (!result.ok) return toast.error(result.error);
    toast.success("現在の営業状況を更新しました"); setEditingCurrent(false); router.refresh();
  });
  return <div className="space-y-4">
    <Card>
      <Card.Header><Card.Title>現在の営業状況</Card.Title>{editingCurrent ? <div className="flex gap-2"><Button variant="ghost" size="sm" onClick={() => setEditingCurrent(false)}><X className="h-4 w-4" />キャンセル</Button><Button size="sm" onClick={saveCurrent} disabled={pending}><Save className="h-4 w-4" />保存</Button></div> : <Button variant="ghost" size="sm" onClick={() => setEditingCurrent(true)}><Pencil className="h-4 w-4" />編集</Button>}</Card.Header>
      <Card.Body className="space-y-4">
        {editingCurrent ? <div className="grid grid-cols-1 sm:grid-cols-2 gap-4"><FormField label="アポ取得日" htmlFor="appointment-date"><Input id="appointment-date" type="date" value={appointmentDate} onChange={(e) => setAppointmentDate(e.target.value)} /></FormField><FormField label="顧客共有メモ" htmlFor="customer-memo" hint={`${memo.length}/5000文字。日付によらず継続して共有する顧客情報です。`} className="sm:col-span-2"><Textarea id="customer-memo" rows={6} maxLength={5000} value={memo} onChange={(e) => setMemo(e.target.value)} /></FormField></div> : <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <Info label="現在の営業状態"><SalesStateBadge state={deriveCurrentSalesState(store, latest)} /></Info>
          <Info label="調査・架電段階"><span>{store.stage}</span></Info>
          <Info label="アポ取得日"><span>{store.appointment_acquired_date ? formatDate(store.appointment_acquired_date) : "未取得"}</span></Info>
          <Info label="営業担当"><span>{store.assigned_sales_user_id ? profileMap.get(store.assigned_sales_user_id) ?? "不明" : "未割当"}</span></Info>
          <Info label="現在の次回アクション"><div className="space-y-1"><Badge tone={urgency === "overdue" ? "destructive" : urgency === "today" ? "warning" : urgency === "upcoming" ? "info" : "outline"}>{NEXT_ACTION_URGENCY_LABELS[urgency]}</Badge><p>{[currentNext.date ? formatDate(currentNext.date) : null, currentNext.type, currentNext.note].filter(Boolean).join(" / ") || "未設定"}</p>{currentNext.source === "legacy-store" ? <p className="text-xs text-muted-foreground">旧Store値を表示中。次の営業記録から履歴として保存されます。</p> : null}</div></Info>
          <Info label="最終営業日"><span>{latest ? formatDate(latest.date) : "営業記録なし"}</span></Info>
          <Info label="顧客共有メモ" wide><p className="whitespace-pre-wrap break-words">{store.memo || "未設定"}</p><p className="text-xs text-muted-foreground mt-1">連絡しやすい時間帯や注意事項など、継続して共有する情報です。</p></Info>
        </dl>}
      </Card.Body>
    </Card>

    <div className="flex justify-end"><Button onClick={() => setFormTarget("new")}><Plus className="h-4 w-4" />営業記録を追加</Button></div>
    {formTarget === "new" ? <SalesActivityForm store={store} profiles={profiles} onClose={closeForm} /> : null}

    {latest ? <ActivityCard title="最新の営業記録" deal={latest} profileName={latest.assigned_sales_user_id ? profileMap.get(latest.assigned_sales_user_id) : undefined} open>
      {formTarget === latest.id ? <SalesActivityForm store={store} deal={latest} profiles={profiles} onClose={closeForm} /> : <Button variant="outline" size="sm" onClick={() => setFormTarget(latest.id)}><Pencil className="h-4 w-4" />編集</Button>}
    </ActivityCard> : <Card><Card.Body className="py-8 text-center text-muted-foreground">営業記録はまだありません。</Card.Body></Card>}

    {history.length ? <section className="space-y-2"><h3 className="font-semibold">過去の営業履歴</h3>{history.map((deal) => <details key={deal.id} className="rounded-lg border border-border bg-card p-3"><summary className="cursor-pointer flex flex-wrap items-center gap-3"><span>{formatDate(deal.date)}</span><span>{deal.meeting_type}</span><DealStatusBadge status={deal.status} />{deal.next_action_date ? <span className="text-xs text-muted-foreground">次回 {formatDate(deal.next_action_date)}</span> : null}</summary><div className="pt-4">{formTarget === deal.id ? <SalesActivityForm store={store} deal={deal} profiles={profiles} onClose={closeForm} /> : <><ActivityDetails deal={deal} profileName={deal.assigned_sales_user_id ? profileMap.get(deal.assigned_sales_user_id) : undefined} /><Button variant="outline" size="sm" className="mt-3" onClick={() => setFormTarget(deal.id)}><Pencil className="h-4 w-4" />編集</Button></>}</div></details>)}</section> : null}
  </div>;
}

function Info({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) { return <div className={wide ? "sm:col-span-2" : ""}><dt className="text-xs font-semibold text-muted-foreground mb-1">{label}</dt><dd>{children}</dd></div>; }
function ActivityCard({ title, deal, profileName, children }: { title: string; deal: Deal; profileName?: string; open?: boolean; children: React.ReactNode }) { return <Card><Card.Header><div><Card.Title>{title}</Card.Title><div className="flex flex-wrap gap-2 mt-2 text-sm"><span>{formatDate(deal.date)}</span><span>{deal.meeting_type}</span><DealStatusBadge status={deal.status} /></div></div>{children}</Card.Header><Card.Body><ActivityDetails deal={deal} profileName={profileName} /></Card.Body></Card>; }
function ActivityDetails({ deal, profileName }: { deal: Deal; profileName?: string }) { const items: Array<[string, React.ReactNode]> = [["営業担当", profileName ?? "未割当"], ["営業メモ", deal.activity_memo], ["提案内容", deal.proposal], ["ヒアリング内容", deal.discussion], ["見積金額", deal.estimate_amount ? formatYen(deal.estimate_amount) : null], ["受注金額", deal.order_amount !== null ? formatYen(deal.order_amount) : null], ["失注理由", deal.lost_reason], ["当時設定した次回アクション", [deal.next_action_date ? formatDate(deal.next_action_date) : null, deal.next_action_type, deal.next_action_note].filter(Boolean).join(" / ") || null]]; return <dl className="space-y-3 text-sm">{items.filter(([, value]) => value).map(([label, value]) => <div key={label}><dt className="text-xs font-semibold text-muted-foreground">{label}</dt><dd className="whitespace-pre-wrap break-words leading-6">{value}</dd></div>)}</dl>; }
