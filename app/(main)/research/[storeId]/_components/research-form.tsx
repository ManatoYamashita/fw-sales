"use client";

import { useState, useTransition, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { saveResearchAction } from "@/lib/actions/research-actions";
import { decideChannel, channelReasonFor } from "@/lib/domain/channel";
import { CHANNELS } from "@/types/store";
import { toast } from "@/components/ui/toast";
import type { Research } from "@/types/research";
import type { Store } from "@/types/store";
import type { Profile } from "@/types/profile";

interface ResearchFormProps {
  store: Store;
  research: Research | null;
  /** 調査担当選択肢 (Phase 7: PLANNERS 定数を廃止し profile 名で表示) */
  profiles: readonly Profile[];
}

export function ResearchForm({ store, research, profiles }: ResearchFormProps) {
  const init = research ?? buildInitial(store);
  const [form, setForm] = useState(init);
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
      const result = await saveResearchAction(store.id, null, formData);
      if (result.ok) {
        toast.success(result.message ?? "保存しました");
        router.push(`/stores/${store.id}`);
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <form action={submit} className="space-y-4">
      <Card>
        <Card.Header>
          <Card.Title>口コミ分析</Card.Title>
        </Card.Header>
        <Card.Body className="space-y-4">
          <FormField label="総評" htmlFor="total_review">
            <Input
              id="total_review"
              name="total_review"
              value={form.total_review}
              onChange={onText("total_review")}
              placeholder="例: 食べログ3.4点 / 12件 | 口コミ返信なし"
            />
          </FormField>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="ポジティブな声" htmlFor="review_positive">
              <Textarea
                id="review_positive"
                name="review_positive"
                rows={3}
                value={form.review_positive}
                onChange={onText("review_positive")}
              />
            </FormField>
            <FormField label="ネガティブな声" htmlFor="review_negative">
              <Textarea
                id="review_negative"
                name="review_negative"
                rows={3}
                value={form.review_negative}
                onChange={onText("review_negative")}
              />
            </FormField>
          </div>
        </Card.Body>
      </Card>

      <Card>
        <Card.Header>
          <Card.Title>強み・弱み (S/W)</Card.Title>
        </Card.Header>
        <Card.Body className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {(["strength1", "strength2", "strength3"] as const).map((key, i) => (
            <FormField key={key} label={`強み ${i + 1}`} htmlFor={key}>
              <Input
                id={key}
                name={key}
                value={form[key]}
                onChange={onText(key)}
              />
            </FormField>
          ))}
          <div className="hidden md:block" />
          {(["weakness1", "weakness2", "weakness3"] as const).map((key, i) => (
            <FormField key={key} label={`弱み ${i + 1}`} htmlFor={key}>
              <Input
                id={key}
                name={key}
                value={form[key]}
                onChange={onText(key)}
              />
            </FormField>
          ))}
        </Card.Body>
      </Card>

      <Card>
        <Card.Header>
          <Card.Title>ギャップ分析(改善余地)</Card.Title>
        </Card.Header>
        <Card.Body className="space-y-4">
          {(
            [
              ["meo_gap", "MEO/Googleマップ"],
              ["hp_gap", "公式サイト"],
              ["instagram_gap", "Instagram"],
            ] as const
          ).map(([key, label]) => (
            <FormField key={key} label={label} htmlFor={key}>
              <Textarea
                id={key}
                name={key}
                rows={2}
                value={form[key]}
                onChange={onText(key)}
              />
            </FormField>
          ))}
        </Card.Body>
      </Card>

      <Card>
        <Card.Header>
          <Card.Title>チャネル判定 / 営業フック</Card.Title>
        </Card.Header>
        <Card.Body className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="想定チャネル" htmlFor="channel">
              <Select
                id="channel"
                name="channel"
                value={form.channel}
                onChange={(e) => {
                  const v = e.target.value as (typeof CHANNELS)[number];
                  setForm((prev) => ({
                    ...prev,
                    channel: v,
                    channel_reason: prev.channel_reason || channelReasonFor(v),
                  }));
                }}
              >
                {CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="判定の根拠" htmlFor="channel_reason">
              <Textarea
                id="channel_reason"
                name="channel_reason"
                rows={2}
                value={form.channel_reason}
                onChange={onText("channel_reason")}
              />
            </FormField>
          </div>
          <FormField label="営業フック(刺さる一言)" htmlFor="sales_hook">
            <Textarea
              id="sales_hook"
              name="sales_hook"
              rows={2}
              value={form.sales_hook}
              onChange={onText("sales_hook")}
            />
          </FormField>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="入口商品" htmlFor="entry_product">
              <Input
                id="entry_product"
                name="entry_product"
                value={form.entry_product}
                onChange={onText("entry_product")}
              />
            </FormField>
            <FormField label="本命商品" htmlFor="main_product">
              <Input
                id="main_product"
                name="main_product"
                value={form.main_product}
                onChange={onText("main_product")}
              />
            </FormField>
          </div>
          <FormField label="調査担当" htmlFor="researcher">
            <Select
              id="researcher"
              name="researcher"
              value={form.researcher}
              onChange={onText("researcher")}
            >
              {profiles.map((p) => (
                <option key={p.id} value={p.display_name}>
                  {p.display_name}
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
            {pending ? "保存中…" : research ? "更新する" : "調査を保存"}
          </Button>
        </Card.Footer>
      </Card>
    </form>
  );
}

function buildInitial(store: Store): Research {
  const now = new Date().toISOString().split("T")[0]!;
  return {
    id: "",
    store_id: store.id,
    store_name: store.name,
    total_review: "",
    strength1: "",
    strength2: "",
    strength3: "",
    weakness1: "",
    weakness2: "",
    weakness3: "",
    review_positive: "",
    review_negative: "",
    meo_gap: "",
    hp_gap: "",
    instagram_gap: "",
    channel: decideChannel(store.has_contact_form),
    channel_reason: channelReasonFor(decideChannel(store.has_contact_form)),
    sales_hook: "",
    entry_product: "",
    main_product: "",
    researcher: "佐藤",
    status: "完了",
    created_at: now,
    updated_at: now,
  };
}
