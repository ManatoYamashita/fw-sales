"use client";

import { useState, useTransition, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2 } from "lucide-react";
import {
  completeHandoffAction,
  updateHandoffAction,
} from "@/lib/actions/handoff-actions";
import { OPS_MEMBERS } from "@/lib/domain/staff";
import { toast } from "@/components/ui/toast";
import type { Handoff } from "@/types/handoff";

export function HandoffForm({ handoff }: { handoff: Handoff }) {
  const [form, setForm] = useState({
    contract_services: handoff.contract_services,
    initial_fee: String(handoff.initial_fee ?? ""),
    monthly_fee: String(handoff.monthly_fee ?? ""),
    contract_period: handoff.contract_period,
    expected_result: handoff.expected_result,
    contract_owner: handoff.contract_owner,
    caution: handoff.caution,
    ng_items: handoff.ng_items,
    due_date: handoff.due_date,
    materials_status: handoff.materials_status,
    ops_assignee: handoff.ops_assignee,
    contract_date: handoff.contract_date,
    payment_confirmed: handoff.payment_confirmed ?? "",
  });
  const [pending, startTransition] = useTransition();
  const [completing, startCompletion] = useTransition();
  const router = useRouter();

  const onText =
    <K extends keyof typeof form>(key: K) =>
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((prev) => ({ ...prev, [key]: e.target.value as (typeof form)[K] }));

  const submit = (formData: FormData) => {
    startTransition(async () => {
      const result = await updateHandoffAction(handoff.id, null, formData);
      if (result.ok) {
        toast.success(result.message ?? "更新しました");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  const complete = () => {
    startCompletion(async () => {
      const result = await completeHandoffAction(handoff.id);
      if (result.ok) {
        toast.success(result.message ?? "完了にしました");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <form action={submit} className="space-y-4">
      {handoff.status === "完了" ? (
        <Card>
          <Card.Body className="flex items-center gap-3">
            <CheckCircle2 className="h-6 w-6 text-green-600" />
            <div>
              <p className="text-sm font-semibold text-green-700">
                運用への引き継ぎが完了しました
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                店舗ステージは「引き継ぎ完了」になっています。
              </p>
            </div>
          </Card.Body>
        </Card>
      ) : (
        <Card>
          <Card.Body className="flex items-center justify-between gap-3">
            <div>
              <Badge tone="amber">運用確認待ち</Badge>
              <p className="text-sm text-slate-700 mt-2">
                チェックを終えたら「引き継ぎ完了」を押してください。
              </p>
            </div>
            <Button
              type="button"
              variant="success"
              onClick={complete}
              disabled={completing}
            >
              {completing ? "処理中…" : "引き継ぎを完了"}
            </Button>
          </Card.Body>
        </Card>
      )}

      <Card>
        <Card.Header>
          <Card.Title>契約内容</Card.Title>
        </Card.Header>
        <Card.Body className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            label="契約サービス"
            htmlFor="contract_services"
            className="md:col-span-2"
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
              placeholder="例: 1年(自動更新)"
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
          <FormField label="契約日" htmlFor="contract_date">
            <Input
              id="contract_date"
              name="contract_date"
              type="date"
              value={form.contract_date}
              onChange={onText("contract_date")}
            />
          </FormField>
          <FormField label="入金確認日" htmlFor="payment_confirmed">
            <Input
              id="payment_confirmed"
              name="payment_confirmed"
              type="date"
              value={form.payment_confirmed}
              onChange={onText("payment_confirmed")}
            />
          </FormField>
        </Card.Body>
      </Card>

      <Card>
        <Card.Header>
          <Card.Title>運用チームへ</Card.Title>
        </Card.Header>
        <Card.Body className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
          <FormField label="NG事項" htmlFor="ng_items" className="md:col-span-2">
            <Textarea
              id="ng_items"
              name="ng_items"
              rows={2}
              value={form.ng_items}
              onChange={onText("ng_items")}
            />
          </FormField>
          <FormField
            label="素材・進捗"
            htmlFor="materials_status"
            className="md:col-span-2"
          >
            <Textarea
              id="materials_status"
              name="materials_status"
              rows={2}
              value={form.materials_status}
              onChange={onText("materials_status")}
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
