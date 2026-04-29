"use client";

import { useState, useTransition, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { updateDealAction } from "@/lib/actions/deal-actions";
import { DEAL_STATUSES, type Deal } from "@/types/deal";
import { toast } from "@/components/ui/toast";

export function DealStatusForm({ deal }: { deal: Deal }) {
  const [form, setForm] = useState({
    status: deal.status,
    estimate_amount: String(deal.estimate_amount ?? ""),
    order_amount: deal.order_amount !== null ? String(deal.order_amount) : "",
    proposal: deal.proposal,
    discussion: deal.discussion,
    lost_reason: deal.lost_reason,
  });
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const set = <K extends keyof typeof form>(
    key: K,
    value: (typeof form)[K],
  ) => setForm((prev) => ({ ...prev, [key]: value }));

  const onText =
    <K extends keyof typeof form>(key: K) =>
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      set(key, e.target.value as (typeof form)[K]);

  const submit = (formData: FormData) => {
    startTransition(async () => {
      const result = await updateDealAction(deal.id, null, formData);
      if (result.ok) {
        toast.success(result.message ?? "更新しました");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <form action={submit} className="space-y-4">
      <Card>
        <Card.Header>
          <Card.Title>ステータス・金額</Card.Title>
        </Card.Header>
        <Card.Body className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
          {form.status === "受注" ? (
            <FormField
              label="受注金額"
              htmlFor="order_amount"
              required
              className="md:col-span-2"
            >
              <Input
                id="order_amount"
                name="order_amount"
                type="number"
                min={0}
                value={form.order_amount}
                onChange={onText("order_amount")}
                placeholder="受注額(税抜)"
              />
            </FormField>
          ) : null}
          {form.status === "失注" ? (
            <FormField
              label="失注理由"
              htmlFor="lost_reason"
              required
              className="md:col-span-2"
            >
              <Textarea
                id="lost_reason"
                name="lost_reason"
                rows={2}
                value={form.lost_reason}
                onChange={onText("lost_reason")}
                placeholder="失注理由を簡潔に"
              />
            </FormField>
          ) : null}
        </Card.Body>
      </Card>

      <Card>
        <Card.Header>
          <Card.Title>商談メモ</Card.Title>
        </Card.Header>
        <Card.Body className="space-y-4">
          <FormField label="提案内容" htmlFor="proposal">
            <Textarea
              id="proposal"
              name="proposal"
              rows={3}
              value={form.proposal}
              onChange={onText("proposal")}
            />
          </FormField>
          <FormField label="ヒアリング・打合せ内容" htmlFor="discussion">
            <Textarea
              id="discussion"
              name="discussion"
              rows={5}
              value={form.discussion}
              onChange={onText("discussion")}
            />
          </FormField>
        </Card.Body>
        <Card.Footer>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "保存中…" : "更新する"}
          </Button>
        </Card.Footer>
      </Card>
    </form>
  );
}
