"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Modal, ModalContent, ModalFooter } from "@/components/ui/modal";
import { toast } from "@/components/ui/toast";
import { DealStatusBadge } from "@/components/feature/deal-status-badge";
import { SalesStateBadge } from "@/components/feature/sales-state-badge";
import { updateSalesProgressAction } from "@/lib/actions/store-actions";
import { deleteSalesActivityAction } from "@/lib/actions/deal-actions";
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
  const [assignedSales, setAssignedSales] = useState(store.assigned_sales_user_id ?? "");
  const [memo, setMemo] = useState(store.memo);
  const [pending, startTransition] = useTransition();
  const [formTarget, setFormTarget] = useState<string | "new" | null>(() => searchParams.get("action") === "new" ? "new" : searchParams.get("activity"));
  const [deleteTarget, setDeleteTarget] = useState<Deal | null>(null);
  const [deleting, startDeleteTransition] = useTransition();
  const sorted = [...deals].sort(compareDealsNewestFirst);
  const latest = pickLatestDeal(deals);
  const history = sorted.filter((d) => d.id !== latest?.id);
  const currentNext = deriveCurrentNextAction(store, latest);
  const urgency = getNextActionUrgency(currentNext.date, todayInTimeZone("Asia/Tokyo"));
  const profileMap = new Map(profiles.map((p) => [p.id, p.display_name]));
  // 現在の担当者が profiles に含まれない (削除済み / 取得漏れ) 場合の Select 受け皿。
  const unknownSalesId = store.assigned_sales_user_id && !profileMap.has(store.assigned_sales_user_id) ? store.assigned_sales_user_id : null;
  // deep link (?activity= / ?action=new) で開いた場合だけ URL を戻す。クエリがなければ
  // replace を発行しない (保存成功時の router.refresh と replace を無駄に重ねない)
  const clearFormQuery = () => { if (searchParams.get("activity") || searchParams.get("action")) router.replace(`/stores/${store.id}?tab=progress`); };
  const closeForm = () => { setFormTarget(null); clearFormQuery(); };
  const confirmDelete = () => {
    const target = deleteTarget;
    if (!target || deleting) return;
    startDeleteTransition(async () => {
      const result = await deleteSalesActivityAction(target.id);
      if (!result.ok) return toast.error(result.error);
      toast.success(result.message ?? "営業記録を削除しました");
      setDeleteTarget(null);
      if (formTarget === target.id) setFormTarget(null);
      // URL に削除済みの activity ID を残さない。replace しない場合のみ refresh を発行する
      if (searchParams.get("activity") === target.id) router.replace(`/stores/${store.id}?tab=progress`);
      else router.refresh();
    });
  };
  // 編集開始時 (通常の「編集」ボタンからも、キャンセル後の再編集からも) は必ず
  // props (= 保存済みの値) から draft を再初期化する。これにより (1) キャンセルで
  // 破棄した入力が残らない、(2) 保存成功後に届いた新しい props が draft へ正しく
  // 反映される、の両方を satisfy する。編集中は props が変わっても draft を
  // 上書きしない (入力中の値を消さない)。
  const resetDraftFromStore = () => {
    setAppointmentDate(store.appointment_acquired_date ?? "");
    setAssignedSales(store.assigned_sales_user_id ?? "");
    setMemo(store.memo);
  };
  const beginEditCurrent = () => { resetDraftFromStore(); setEditingCurrent(true); };
  const cancelEditCurrent = () => { resetDraftFromStore(); setEditingCurrent(false); };
  const saveCurrent = () => startTransition(async () => {
    const data = new FormData();
    data.set("appointment_acquired_date", appointmentDate);
    // Store.assigned_sales_user_id のみを更新する。Deal 側の担当 (その活動を誰が
    // 行ったか) は営業記録フォームの責務で、ここからは絶対に触らない。
    data.set("assigned_sales_user_id", assignedSales);
    data.set("memo", memo);
    const result = await updateSalesProgressAction(store.id, data);
    if (!result.ok) return toast.error(result.error);
    toast.success("現在の営業状況を更新しました"); setEditingCurrent(false); router.refresh();
  });
  return <div className="space-y-4">
    <Card>
      <Card.Header><Card.Title>現在の営業状況</Card.Title>{editingCurrent ? <div className="flex gap-2"><Button variant="ghost" size="sm" onClick={cancelEditCurrent}><X className="h-4 w-4" />キャンセル</Button><Button size="sm" onClick={saveCurrent} disabled={pending}><Save className="h-4 w-4" />保存</Button></div> : <Button variant="ghost" size="sm" onClick={beginEditCurrent}><Pencil className="h-4 w-4" />編集</Button>}</Card.Header>
      {/*
        表示モードと編集モードで **同じ 7 行を同じ順序で** 描画する (partial edit)。
        以前は編集モードが 2 フィールドのグリッドへ丸ごと差し替わり、derived 項目が
        画面から消えていた。「編集を押したら情報が減る」体験をやめ、
        直接値 (営業担当 / アポ取得日 / 顧客共有メモ) だけが入力欄に変わる形にする。

        1 つの <dl> を両モードで共有することで、行の増減・順序ずれが構造的に起きない。
        編集可能な行は <dt> 側を <label htmlFor> にして入力要素と関連付ける。
      */}
      <Card.Body className="space-y-4">
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <Info label="現在の営業状態" note={editingCurrent ? "営業記録から自動" : undefined}>
            <SalesStateBadge state={deriveCurrentSalesState(store, latest)} />
          </Info>

          <Info label="調査・架電段階" note={editingCurrent ? "画面上部で変更" : undefined}>
            <span>{store.stage}</span>
          </Info>

          <Info label="アポ取得日" htmlFor={editingCurrent ? "appointment-date" : undefined}>
            {editingCurrent ? (
              <div className="space-y-1.5">
                <Input id="appointment-date" type="date" value={appointmentDate} onChange={(e) => setAppointmentDate(e.target.value)} />
                {/*
                  日付が入っているときだけ出す。「クリア」だと入力欄を空にするだけの
                  操作に読めるが、実際は保存で appointment_acquired_date が null =
                  アポ未取得の状態に戻る (現在の営業状態の判定からも外れる) ため、
                  結果を語る文言にする。押した時点では draft を空にするだけで保存しない。
                */}
                {appointmentDate ? (
                  <button type="button" onClick={() => setAppointmentDate("")} className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    未取得に戻す
                  </button>
                ) : null}
              </div>
            ) : (
              <span>{store.appointment_acquired_date ? formatDate(store.appointment_acquired_date) : "未取得"}</span>
            )}
          </Info>

          <Info label="営業担当" htmlFor={editingCurrent ? "assigned-sales" : undefined}>
            {editingCurrent ? (
              <Select id="assigned-sales" value={assignedSales} onChange={(e) => setAssignedSales(e.target.value)} className="text-foreground">
                <option value="">未割当</option>
                {profiles.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
                {/*
                  現在の担当者が profiles に無い (削除済み等) 場合の受け皿。
                  一致する option が無いと <select> は先頭 (未割当) を表示し、
                  ユーザーが触っていないのに保存で担当が消える。
                */}
                {unknownSalesId ? <option value={unknownSalesId}>不明な担当者</option> : null}
              </Select>
            ) : (
              <span>{store.assigned_sales_user_id ? profileMap.get(store.assigned_sales_user_id) ?? "不明な担当者" : "未割当"}</span>
            )}
          </Info>

          <Info label="現在の次回アクション" note={editingCurrent ? "営業記録で設定" : undefined}>
            <div className="space-y-1">
              <Badge tone={urgency === "overdue" ? "destructive" : urgency === "today" ? "warning" : urgency === "upcoming" ? "info" : "outline"}>{NEXT_ACTION_URGENCY_LABELS[urgency]}</Badge>
              <p>{[currentNext.date ? formatDate(currentNext.date) : null, currentNext.type, currentNext.note].filter(Boolean).join(" / ") || "未設定"}</p>
              {currentNext.source === "legacy-store" ? <p className="text-xs text-muted-foreground">旧Store値を表示中。次の営業記録から履歴として保存されます。</p> : null}
              {/*
                次回アクションの単一の書き込み先は Deal。Store 側へ直接書く経路は
                作らず、既存の営業記録フォーム (formTarget / ?action=new / ?activity=<id>)
                へ誘導する。

                出すのは **未設定のときだけ**。値が入っている場合はすぐ下の
                「最新の営業記録」カードに編集導線があり、ここにも置くと同じ画面に
                3 つ目の導線ができて表示モードがうるさくなる。
                「未設定」とだけ表示されて手詰まりになる状態だけを解消する。
              */}
              {currentNext.source === "unset" ? (
                <NextActionCta onClick={() => setFormTarget("new")} label="次回アクションを設定" />
              ) : null}
            </div>
          </Info>

          <Info label="最終営業日">
            <span>{latest ? formatDate(latest.date) : "営業記録なし"}</span>
          </Info>

          <Info label="顧客共有メモ" wide htmlFor={editingCurrent ? "customer-memo" : undefined}>
            {editingCurrent ? (
              <>
                <Textarea id="customer-memo" rows={6} maxLength={5000} value={memo} onChange={(e) => setMemo(e.target.value)} />
                <p className="text-xs text-muted-foreground mt-1">{memo.length}/5000文字。日付によらず継続して共有する顧客情報です。</p>
              </>
            ) : (
              <>
                <p className="whitespace-pre-wrap break-words">{store.memo || "未設定"}</p>
                <p className="text-xs text-muted-foreground mt-1">連絡しやすい時間帯や注意事項など、継続して共有する情報です。</p>
              </>
            )}
          </Info>
        </dl>
      </Card.Body>
    </Card>

    <div className="flex justify-end"><Button onClick={() => setFormTarget("new")}><Plus className="h-4 w-4" />営業記録を追加</Button></div>
    {formTarget === "new" ? <SalesActivityForm store={store} profiles={profiles} onClose={closeForm} /> : null}

    {/* 最新の営業記録。編集フォームは Card.Header の右側 (狭い操作領域) ではなく
        Card.Body の全幅へ表示する (#172)。Header 右側には小さな操作ボタンだけを置く */}
    {latest ? <Card>
      <Card.Header>
        <div><Card.Title>最新の営業記録</Card.Title><div className="flex flex-wrap gap-2 mt-2 text-sm"><span>{formatDate(latest.date)}</span><span>{latest.meeting_type}</span><DealStatusBadge status={latest.status} /></div></div>
        {formTarget === latest.id ? null : <ActivityRowActions deal={latest} onEdit={() => setFormTarget(latest.id)} onDelete={() => setDeleteTarget(latest)} />}
      </Card.Header>
      <Card.Body>
        {formTarget === latest.id
          ? <SalesActivityForm store={store} deal={latest} profiles={profiles} onClose={closeForm} />
          : <ActivityDetails deal={latest} profileName={latest.assigned_sales_user_id ? profileMap.get(latest.assigned_sales_user_id) : undefined} />}
      </Card.Body>
    </Card> : <Card><Card.Body className="py-8 text-center text-muted-foreground">営業記録はまだありません。</Card.Body></Card>}

    {history.length ? <section className="space-y-2"><h3 className="font-semibold">過去の営業履歴</h3>{history.map((deal) => <details key={deal.id} open={formTarget === deal.id} className="rounded-lg border border-border bg-card p-3"><summary className="cursor-pointer flex flex-wrap items-center gap-3"><span>{formatDate(deal.date)}</span><span>{deal.meeting_type}</span><DealStatusBadge status={deal.status} />{deal.next_action_date ? <span className="text-xs text-muted-foreground">次回 {formatDate(deal.next_action_date)}</span> : null}</summary><div className="pt-4">{formTarget === deal.id ? <SalesActivityForm store={store} deal={deal} profiles={profiles} onClose={closeForm} /> : <><ActivityDetails deal={deal} profileName={deal.assigned_sales_user_id ? profileMap.get(deal.assigned_sales_user_id) : undefined} /><div className="mt-3"><ActivityRowActions deal={deal} onEdit={() => setFormTarget(deal.id)} onDelete={() => setDeleteTarget(deal)} /></div></>}</div></details>)}</section> : null}

    {/* 削除確認ダイアログ (#172)。window.confirm ではなく既存 Modal パターンを使う。
        削除中は閉じる操作を無効化し、確定ボタンは二重クリックを防止する */}
    <Modal open={deleteTarget !== null} onOpenChange={(next) => { if (!next && !deleting) setDeleteTarget(null); }}>
      {deleteTarget ? <ModalContent title="営業記録を削除しますか?" description="この操作は取り消せません。" size="sm">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold">{formatDate(deleteTarget.date)}</span>
          <span>{deleteTarget.meeting_type}</span>
          <DealStatusBadge status={deleteTarget.status} />
        </div>
        <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
          {latest?.id === deleteTarget.id
            ? history.length
              ? "最新の営業記録を削除すると、一つ前の記録が最新の営業状態として表示されます。"
              : "この店舗の最後の営業記録です。削除すると「営業記録はまだありません」と表示されます。"
            : "過去の履歴のため、最新の営業状態には影響しません。"}
        </p>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setDeleteTarget(null)} disabled={deleting}>キャンセル</Button>
          <Button variant="danger" onClick={confirmDelete} disabled={deleting}>{deleting ? "削除中…" : "削除する"}</Button>
        </ModalFooter>
      </ModalContent> : null}
    </Modal>
  </div>;
}

/** 営業記録 1 件分の操作ボタン (編集 / 削除)。Header 右側や履歴内に置く小さなボタン群 */
function ActivityRowActions({ deal, onEdit, onDelete }: { deal: Deal; onEdit: () => void; onDelete: () => void }) {
  return <div className="flex items-center gap-1.5">
    <Button variant="outline" size="sm" onClick={onEdit}><Pencil className="h-4 w-4" />編集</Button>
    <Button variant="ghost" size="sm" onClick={onDelete} aria-label={`${formatDate(deal.date)}の営業記録を削除`} className="text-red-600 hover:text-red-700 hover:bg-red-50"><Trash2 className="h-4 w-4" />削除</Button>
  </div>;
}

/**
 * カード 1 行 (label + value)。表示モードと編集モードで共有する。
 *
 * @param htmlFor 編集モードで入力要素と関連付ける id。指定時は <dt> が <label> になる。
 * @param note derived 項目に付ける補助文。**編集モードでのみ渡す**。
 *   「編集を押したのに入力欄にならない理由」を説明するためのもので、
 *   通常表示にも出すと読むものが増えて一覧性が落ちる。
 */
function Info({ label, htmlFor, note, wide, children }: { label: string; htmlFor?: string; note?: string; wide?: boolean; children: React.ReactNode }) {
  return <div className={wide ? "sm:col-span-2" : ""}>
    <dt className="text-xs font-semibold text-muted-foreground mb-1">{htmlFor ? <label htmlFor={htmlFor}>{label}</label> : label}</dt>
    <dd>{children}{note ? <p className="text-xs text-muted-foreground mt-1">{note}</p> : null}</dd>
  </div>;
}

/**
 * 次回アクションの導線。Deal が単一の書き込み先なので、Store へ直接書かず
 * 既存の営業記録フォームを開くだけ (`formTarget`)。
 */
function NextActionCta({ label, onClick }: { label: string; onClick: () => void }) {
  return <Button type="button" variant="outline" size="sm" onClick={onClick} className="mt-1">
    <Plus className="h-3.5 w-3.5" />{label}
  </Button>;
}
function ActivityDetails({ deal, profileName }: { deal: Deal; profileName?: string }) { const items: Array<[string, React.ReactNode]> = [["営業担当", profileName ?? "未割当"], ["営業メモ", deal.activity_memo], ["提案内容", deal.proposal], ["ヒアリング内容", deal.discussion], ["見積金額", deal.estimate_amount ? formatYen(deal.estimate_amount) : null], ["受注金額", deal.order_amount !== null ? formatYen(deal.order_amount) : null], ["失注理由", deal.lost_reason], ["当時設定した次回アクション", [deal.next_action_date ? formatDate(deal.next_action_date) : null, deal.next_action_type, deal.next_action_note].filter(Boolean).join(" / ") || null]]; return <dl className="space-y-3 text-sm">{items.filter(([, value]) => value).map(([label, value]) => <div key={label}><dt className="text-xs font-semibold text-muted-foreground">{label}</dt><dd className="whitespace-pre-wrap break-words leading-6">{value}</dd></div>)}</dl>; }
