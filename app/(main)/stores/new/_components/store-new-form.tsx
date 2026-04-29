"use client";

import { useState, useTransition, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { ServiceCheckboxGroup } from "./service-checkbox-group";
import { UrlImportPanel } from "./url-import-panel";
import { createStoreAction } from "@/lib/actions/store-actions";
import { decideChannel } from "@/lib/domain/channel";
import { CONTACT_FORMS, PRIORITIES } from "@/types/store";
import { PLANNERS, SALES } from "@/lib/domain/staff";
import { toast } from "@/components/ui/toast";
import type { ApplyResult } from "@/lib/url-parser/types";

type FormState = {
  name: string;
  prefecture: string;
  city: string;
  address: string;
  genre: string;
  priority: string;
  has_contact_form: string;
  channel: string;
  map_url: string;
  site_url: string;
  instagram_url: string;
  phone: string;
  target_service: string;
  review_count: string;
  review_avg: string;
  memo: string;
  assigned_planner: string;
  assigned_sales: string;
};

const INITIAL: FormState = {
  name: "",
  prefecture: "",
  city: "",
  address: "",
  genre: "",
  priority: "中",
  has_contact_form: "未確認",
  channel: "未判定",
  map_url: "",
  site_url: "",
  instagram_url: "",
  phone: "",
  target_service: "",
  review_count: "",
  review_avg: "",
  memo: "",
  assigned_planner: "佐藤",
  assigned_sales: "",
};

export function StoreNewForm() {
  const [form, setForm] = useState<FormState>(INITIAL);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      // has_contact_form を変えたらチャネル候補を自動で再判定
      if (key === "has_contact_form") {
        next.channel = decideChannel(value as FormState["has_contact_form"] as never);
      }
      return next;
    });
  };

  const onText =
    <K extends keyof FormState>(key: K) =>
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      set(key, e.target.value as FormState[K]);

  const applyImport = (suggested: ApplyResult) => {
    setForm((prev) => ({
      ...prev,
      name: suggested.name || prev.name,
      prefecture: suggested.prefecture || prev.prefecture,
      city: suggested.city || prev.city,
      address: suggested.address || prev.address,
      genre: suggested.genre || prev.genre,
      map_url: suggested.map_url || prev.map_url,
      instagram_url: suggested.instagram_url || prev.instagram_url,
      phone: suggested.phone || prev.phone,
      review_count:
        suggested.review_count !== null
          ? String(suggested.review_count)
          : prev.review_count,
      review_avg:
        suggested.review_avg !== null
          ? String(suggested.review_avg)
          : prev.review_avg,
      memo: suggested.memo
        ? prev.memo
          ? `${prev.memo}\n${suggested.memo}`
          : suggested.memo
        : prev.memo,
    }));
  };

  const submit = (formData: FormData) => {
    startTransition(async () => {
      const result = await createStoreAction(null, formData);
      if (result.ok) {
        toast.success(result.message ?? "登録しました");
        router.push(`/stores/${result.data.id}`);
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <form action={submit} className="space-y-4">
      <UrlImportPanel onApply={applyImport} />

      <Card>
        <Card.Header>
          <Card.Title>基本情報</Card.Title>
        </Card.Header>
        <Card.Body className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="店舗名" required htmlFor="name" className="md:col-span-2">
            <Input
              id="name"
              name="name"
              required
              value={form.name}
              onChange={onText("name")}
              placeholder="例: 導楽"
            />
          </FormField>
          <FormField label="都道府県" htmlFor="prefecture">
            <Input
              id="prefecture"
              name="prefecture"
              value={form.prefecture}
              onChange={onText("prefecture")}
              placeholder="例: 神奈川県"
            />
          </FormField>
          <FormField label="市区町村" htmlFor="city">
            <Input
              id="city"
              name="city"
              value={form.city}
              onChange={onText("city")}
              placeholder="例: 川崎市中原区"
            />
          </FormField>
          <FormField label="住所・最寄駅" htmlFor="address" className="md:col-span-2">
            <Input
              id="address"
              name="address"
              value={form.address}
              onChange={onText("address")}
              placeholder="例: 新丸子駅周辺"
            />
          </FormField>
          <FormField label="業態" htmlFor="genre">
            <Input
              id="genre"
              name="genre"
              value={form.genre}
              onChange={onText("genre")}
              placeholder="例: 居酒屋"
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
          <FormField label="GoogleマップURL" htmlFor="map_url" className="md:col-span-2">
            <Input
              id="map_url"
              name="map_url"
              value={form.map_url}
              onChange={onText("map_url")}
              placeholder="https://maps.google.com/..."
            />
          </FormField>
          <FormField label="公式サイトURL" htmlFor="site_url">
            <Input
              id="site_url"
              name="site_url"
              type="url"
              value={form.site_url}
              onChange={onText("site_url")}
              placeholder="https://example.com"
            />
          </FormField>
          <FormField label="Instagram URL" htmlFor="instagram_url">
            <Input
              id="instagram_url"
              name="instagram_url"
              type="url"
              value={form.instagram_url}
              onChange={onText("instagram_url")}
              placeholder="https://instagram.com/..."
            />
          </FormField>
          <FormField label="電話番号" htmlFor="phone">
            <Input
              id="phone"
              name="phone"
              value={form.phone}
              onChange={onText("phone")}
              placeholder="例: 03-1234-5678"
            />
          </FormField>
          <FormField
            label="問い合わせフォームの有無"
            htmlFor="has_contact_form"
            hint="「あり/なし」を選ぶとチャネル候補が自動判定されます"
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
          <FormField
            label="想定チャネル"
            htmlFor="channel"
            hint="フォームの有無から自動推定された値です。手動で変更可能です。"
            className="md:col-span-2"
          >
            <Input
              id="channel"
              name="channel"
              value={form.channel}
              onChange={onText("channel")}
              readOnly
              className="bg-slate-50"
            />
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
              placeholder="現状の評価ポイント、気になる動向、調査メモなど"
            />
          </FormField>
        </Card.Body>
        <Card.Footer>
          <Button
            type="button"
            variant="ghost"
            onClick={() => router.back()}
          >
            キャンセル
          </Button>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "登録中…" : "登録する"}
          </Button>
        </Card.Footer>
      </Card>
    </form>
  );
}
