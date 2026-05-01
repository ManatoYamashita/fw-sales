"use client";

import { useState, useTransition, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { recordActionAction } from "@/lib/actions/action-actions";
import { today } from "@/lib/utils/date";
import { toast } from "@/components/ui/toast";

const RESULTS = [
  "未実施",
  "送信済み",
  "架電済み",
  "不通",
  "反応あり",
  "商談化",
  "NG",
] as const;

export function ActionRecordForm({ storeId }: { storeId: string }) {
  const [form, setForm] = useState({
    date: today(),
    result: "未実施",
    memo: "",
  });
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const onText =
    <K extends keyof typeof form>(key: K) =>
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((prev) => ({ ...prev, [key]: e.target.value as (typeof form)[K] }));

  const submit = (formData: FormData) => {
    startTransition(async () => {
      const result = await recordActionAction(storeId, null, formData);
      if (result.ok) {
        toast.success(result.message ?? "記録しました");
        router.refresh();
        if (result.data.nextStage === "商談化") {
          router.push(`/deals/new?store=${storeId}`);
        }
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <form action={submit}>
      <Card>
        <Card.Header>
          <Card.Title>実行記録</Card.Title>
        </Card.Header>
        <Card.Body className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="実行日" htmlFor="date">
            <Input
              id="date"
              name="date"
              type="date"
              value={form.date}
              onChange={onText("date")}
            />
          </FormField>
          <FormField label="結果" htmlFor="result">
            <Select
              id="result"
              name="result"
              value={form.result}
              onChange={onText("result")}
            >
              {RESULTS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="メモ" htmlFor="memo" className="md:col-span-2">
            <Textarea
              id="memo"
              name="memo"
              rows={3}
              value={form.memo}
              onChange={onText("memo")}
              placeholder="通話内容、反応など"
            />
          </FormField>
        </Card.Body>
        <Card.Footer>
          <Link
            href={`/stores/${storeId}`}
            className="inline-flex h-10 px-4 items-center rounded-lg text-sm text-foreground hover:bg-muted"
          >
            キャンセル
          </Link>
          <Link
            href={`/deals/new?store=${storeId}`}
            className="inline-flex h-10 px-4 items-center rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
          >
            商談化する
          </Link>
          <Button type="submit" variant="success" disabled={pending}>
            {pending ? "記録中…" : "記録を保存"}
          </Button>
        </Card.Footer>
      </Card>
    </form>
  );
}
