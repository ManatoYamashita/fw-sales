"use client";

import { useState, useTransition, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { ServiceCheckboxGroup } from "@/app/(main)/stores/new/_components/service-checkbox-group";
import { updateStoreAction } from "@/lib/actions/store-actions";
import { decideChannel } from "@/lib/domain/channel";
import { CONTACT_FORMS, PRIORITIES, CHANNELS } from "@/types/store";
import { PLANNERS, SALES } from "@/lib/domain/staff";
import { toast } from "@/components/ui/toast";
import type { Store } from "@/types/store";

export function StoreEditForm({ store }: { store: Store }) {
  const [form, setForm] = useState({
    name: store.name,
    prefecture: store.prefecture,
    city: store.city,
    address: store.address,
    genre: store.genre,
    priority: store.priority,
    has_contact_form: store.has_contact_form,
    channel: store.channel,
    map_url: store.map_url,
    site_url: store.site_url,
    instagram_url: store.instagram_url,
    phone: store.phone,
    target_service: store.target_service,
    review_count: String(store.review_count ?? ""),
    review_avg: String(store.review_avg ?? ""),
    memo: store.memo,
    assigned_planner: store.assigned_planner,
    assigned_sales: store.assigned_sales,
  });
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const set = <K extends keyof typeof form>(
    key: K,
    value: (typeof form)[K],
  ) => {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === "has_contact_form") {
        next.channel = decideChannel(value as Store["has_contact_form"]);
      }
      return next;
    });
  };

  const onText =
    <K extends keyof typeof form>(key: K) =>
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      set(key, e.target.value as (typeof form)[K]);

  const submit = (formData: FormData) => {
    startTransition(async () => {
      const result = await updateStoreAction(store.id, null, formData);
      if (result.ok) {
        toast.success(result.message ?? "更新しました");
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
          <Card.Title>基本情報</Card.Title>
        </Card.Header>
        <Card.Body className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            label="店舗名"
            required
            htmlFor="name"
            className="md:col-span-2"
          >
            <Input
              id="name"
              name="name"
              required
              value={form.name}
              onChange={onText("name")}
            />
          </FormField>
          <FormField label="都道府県" htmlFor="prefecture">
            <Input
              id="prefecture"
              name="prefecture"
              value={form.prefecture}
              onChange={onText("prefecture")}
            />
          </FormField>
          <FormField label="市区町村" htmlFor="city">
            <Input
              id="city"
              name="city"
              value={form.city}
              onChange={onText("city")}
            />
          </FormField>
          <FormField
            label="住所・最寄駅"
            htmlFor="address"
            className="md:col-span-2"
          >
            <Input
              id="address"
              name="address"
              value={form.address}
              onChange={onText("address")}
            />
          </FormField>
          <FormField label="業態" htmlFor="genre">
            <Input
              id="genre"
              name="genre"
              value={form.genre}
              onChange={onText("genre")}
            />
          </FormField>
          <FormField label="優先度" htmlFor="priority">
            <Select
              id="priority"
              name="priority"
              value={form.priority}
              onChange={onText("priority")}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          </FormField>
        </Card.Body>
      </Card>

      <Card>
        <Card.Header>
          <Card.Title>WEB資産・連絡先</Card.Title>
        </Card.Header>
        <Card.Body className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            label="GoogleマップURL"
            htmlFor="map_url"
            className="md:col-span-2"
          >
            <Input
              id="map_url"
              name="map_url"
              value={form.map_url}
              onChange={onText("map_url")}
            />
          </FormField>
          <FormField label="公式サイトURL" htmlFor="site_url">
            <Input
              id="site_url"
              name="site_url"
              type="url"
              value={form.site_url}
              onChange={onText("site_url")}
            />
          </FormField>
          <FormField label="Instagram URL" htmlFor="instagram_url">
            <Input
              id="instagram_url"
              name="instagram_url"
              type="url"
              value={form.instagram_url}
              onChange={onText("instagram_url")}
            />
          </FormField>
          <FormField label="電話番号" htmlFor="phone">
            <Input
              id="phone"
              name="phone"
              value={form.phone}
              onChange={onText("phone")}
            />
          </FormField>
          <FormField
            label="問い合わせフォームの有無"
            htmlFor="has_contact_form"
          >
            <Select
              id="has_contact_form"
              name="has_contact_form"
              value={form.has_contact_form}
              onChange={onText("has_contact_form")}
            >
              {CONTACT_FORMS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="想定チャネル" htmlFor="channel">
            <Select
              id="channel"
              name="channel"
              value={form.channel}
              onChange={onText("channel")}
            >
              {CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </FormField>
        </Card.Body>
      </Card>

      <Card>
        <Card.Header>
          <Card.Title>提案候補・営業メモ</Card.Title>
        </Card.Header>
        <Card.Body className="space-y-4">
          <FormField label="提案商材">
            <ServiceCheckboxGroup
              value={form.target_service}
              onChange={(csv) => set("target_service", csv)}
            />
          </FormField>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="プランナー" htmlFor="assigned_planner">
              <Select
                id="assigned_planner"
                name="assigned_planner"
                value={form.assigned_planner}
                onChange={onText("assigned_planner")}
              >
                <option value="">未割当</option>
                {PLANNERS.map((p) => (
                  <option key={p} value={p}>
                    {p}
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
                <option value="">未割当</option>
                {SALES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="口コミ件数" htmlFor="review_count">
              <Input
                id="review_count"
                name="review_count"
                type="number"
                min={0}
                value={form.review_count}
                onChange={onText("review_count")}
              />
            </FormField>
            <FormField label="口コミ平均(0-5)" htmlFor="review_avg">
              <Input
                id="review_avg"
                name="review_avg"
                type="number"
                min={0}
                max={5}
                step={0.1}
                value={form.review_avg}
                onChange={onText("review_avg")}
              />
            </FormField>
          </div>
          <FormField label="メモ" htmlFor="memo">
            <Textarea
              id="memo"
              name="memo"
              rows={5}
              value={form.memo}
              onChange={onText("memo")}
            />
          </FormField>
          {/* 編集中の stage は維持(ステージ変更は詳細画面のボタンから行う) */}
          <input type="hidden" name="stage" value={store.stage} />
        </Card.Body>
        <Card.Footer>
          <Button type="button" variant="ghost" onClick={() => router.back()}>
            キャンセル
          </Button>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "保存中…" : "保存する"}
          </Button>
        </Card.Footer>
      </Card>
    </form>
  );
}
