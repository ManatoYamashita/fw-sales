"use client";

import { useState, useTransition, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { createDealAction } from "@/lib/actions/deal-actions";
import { DEAL_STATUSES, MEETING_TYPES } from "@/types/deal";
import { SALES } from "@/lib/domain/staff";
import { today } from "@/lib/utils/date";
import { toast } from "@/components/ui/toast";
import type { Store } from "@/types/store";

export function DealNewForm({ store }: { store: Store }) {
  const [form, setForm] = useState({
    date: today(),
    meeting_type: "対面",
    discussion: "",
    proposal: "",
    estimate_amount: "",
    status: "継続追客",
    assigned_sales: store.assigned_sales || "佐藤",
  });
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const onText =
    <K extends keyof typeof form>(key: K) =>
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((prev) => ({ ...prev, [key]: e.target.value as (typeof form)[K] }));

  const submit = (formData: FormData) => {
    startTransition(async () => {
      const result = await createDealAction(store.id, null, formData);
      if (result.ok) {
        toast.success(result.message ?? "作成しました");
        router.push(`/deals/${result.data.id}`);
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <form action={submit} className="space-y-4">
      <Card>
        <Card.Header>
          <Card.Title>新規商談</Card.Title>
        </Card.Header>
        <Card.Body className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="商談日" htmlFor="date">
            <Input
              id="date"
              name="date"
              type="date"
              value={form.date}
              onChange={onText("date")}
            />
          </FormField>
          <FormField label="形式" htmlFor="meeting_type">
            <Select
              id="meeting_type"
              name="meeting_type"
              value={form.meeting_type}
              onChange={onText("meeting_type")}
            >
              {MEETING_TYPES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField
            label="提案内容"
            htmlFor="proposal"
            className="md:col-span-2"
          >
            <Textarea
              id="proposal"
              name="proposal"
              rows={2}
              value={form.proposal}
              onChange={onText("proposal")}
            />
          </FormField>
          <FormField
            label="ヒアリング内容"
            htmlFor="discussion"
            className="md:col-span-2"
          >
            <Textarea
              id="discussion"
              name="discussion"
              rows={4}
              value={form.discussion}
              onChange={onText("discussion")}
            />
          </FormField>
          <FormField label="見積金額" htmlFor="estimate_amount">
            <Input
              id="estimate_amount"
              name="estimate_amount"
              type="number"
              min={0}
              value={form.estimate_amount}
              onChange={onText("estimate_amount")}
            />
          </FormField>
          <FormField label="ステータス" htmlFor="status">
            <Select
              id="status"
              name="status"
              value={form.status}
              onChange={onText("status")}
            >
              {DEAL_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="営業担当" htmlFor="assigned_sales">
            <Select
              id="assigned_sales"
              name="assigned_sales"
              value={form.assigned_sales}
              onChange={onText("assigned_sales")}
            >
              {SALES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </FormField>
        </Card.Body>
        <Card.Footer>
          <Button type="button" variant="ghost" onClick={() => router.back()}>
            キャンセル
          </Button>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "作成中…" : "商談を作成"}
          </Button>
        </Card.Footer>
      </Card>
    </form>
  );
}
