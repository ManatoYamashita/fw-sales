"use client";

import { useState, useTransition, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { createHandoffAction } from "@/lib/actions/handoff-actions";
import { OPS_MEMBERS } from "@/lib/domain/staff";
import { today } from "@/lib/utils/date";
import { toast } from "@/components/ui/toast";
import type { Deal } from "@/types/deal";

export function HandoffNewForm({ deal }: { deal: Deal }) {
  const [form, setForm] = useState({
    contract_services: deal.proposal,
    initial_fee: String(deal.order_amount ?? deal.estimate_amount ?? ""),
    monthly_fee: "0",
    contract_period: "1年(自動更新)",
    expected_result: "",
    contract_owner: "佐藤(Firstweb)",
    caution: "",
    ng_items: "",
    due_date: "",
    materials_status: "",
    ops_assignee: "",
    contract_date: today(),
    payment_confirmed: "",
  });
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const onText =
    <K extends keyof typeof form>(key: K) =>
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((prev) => ({ ...prev, [key]: e.target.value as (typeof form)[K] }));

  const submit = (formData: FormData) => {
    startTransition(async () => {
      const result = await createHandoffAction(deal.id, null, formData);
      if (result.ok) {
        toast.success(result.message ?? "作成しました");
        router.push(`/handoffs/${result.data.id}`);
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <form action={submit} className="space-y-4">
      <Card>
        <Card.Header>
          <Card.Title>引き継ぎシート(新規作成)</Card.Title>
        </Card.Header>
        <Card.Body className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            label="契約サービス"
            htmlFor="contract_services"
            className="md:col-span-2"
            required
          >
            <Textarea
              id="contract_services"
              name="contract_services"
              rows={2}
              value={form.contract_services}
              onChange={onText("contract_services")}
            />
          </FormField>
          <FormField label="初期費用" htmlFor="initial_fee">
            <Input
              id="initial_fee"
              name="initial_fee"
              type="number"
              min={0}
              value={form.initial_fee}
              onChange={onText("initial_fee")}
            />
          </FormField>
          <FormField label="月額" htmlFor="monthly_fee">
            <Input
              id="monthly_fee"
              name="monthly_fee"
              type="number"
              min={0}
              value={form.monthly_fee}
              onChange={onText("monthly_fee")}
            />
          </FormField>
          <FormField label="契約期間" htmlFor="contract_period">
            <Input
              id="contract_period"
              name="contract_period"
              value={form.contract_period}
              onChange={onText("contract_period")}
            />
          </FormField>
          <FormField label="契約オーナー" htmlFor="contract_owner">
            <Input
              id="contract_owner"
              name="contract_owner"
              value={form.contract_owner}
              onChange={onText("contract_owner")}
            />
          </FormField>
          <FormField label="運用担当" htmlFor="ops_assignee">
            <Select
              id="ops_assignee"
              name="ops_assignee"
              value={form.ops_assignee}
              onChange={onText("ops_assignee")}
            >
              <option value="">未割当</option>
              {OPS_MEMBERS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="納期" htmlFor="due_date">
            <Input
              id="due_date"
              name="due_date"
              type="date"
              value={form.due_date}
              onChange={onText("due_date")}
            />
          </FormField>
          <FormField
            label="期待効果"
            htmlFor="expected_result"
            className="md:col-span-2"
          >
            <Textarea
              id="expected_result"
              name="expected_result"
              rows={2}
              value={form.expected_result}
              onChange={onText("expected_result")}
            />
          </FormField>
          <FormField
            label="オーナー注意事項"
            htmlFor="caution"
            className="md:col-span-2"
          >
            <Textarea
              id="caution"
              name="caution"
              rows={2}
              value={form.caution}
              onChange={onText("caution")}
            />
          </FormField>
          <FormField
            label="NG事項"
            htmlFor="ng_items"
            className="md:col-span-2"
          >
            <Textarea
              id="ng_items"
              name="ng_items"
              rows={2}
              value={form.ng_items}
              onChange={onText("ng_items")}
            />
          </FormField>
        </Card.Body>
        <Card.Footer>
          <Button type="button" variant="ghost" onClick={() => router.back()}>
            キャンセル
          </Button>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "作成中…" : "引き継ぎを作成"}
          </Button>
        </Card.Footer>
      </Card>
    </form>
  );
}
