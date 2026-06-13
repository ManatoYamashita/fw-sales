"use client";

import { useState, useTransition, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { Pencil, X, Save } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FormField } from "@/components/ui/form-field";
import { StarRating } from "@/components/ui/star-rating";
import { ChannelBadge } from "@/components/feature/channel-badge";
import { ServiceTagList } from "@/components/feature/service-tag-list";
import { ServiceCheckboxGroup } from "@/app/(main)/stores/new/_components/service-checkbox-group";
import { toast } from "@/components/ui/toast";
import { updateStorePatchAction } from "@/lib/actions/store-actions";
import { decideChannel } from "@/lib/domain/channel";
import { formatDate } from "@/lib/utils/date";
import {
  CONTACT_FORMS,
  CHANNELS,
  OPERATOR_TYPES,
  type Store,
  type StorePatch,
} from "@/types/store";
import type { Profile } from "@/types/profile";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  );
}

export interface BasicInfoCardProps {
  store: Store;
  /** 担当者選択肢 (Phase 7: profiles に基づく Select オプション) */
  profiles: readonly Profile[];
}

export function BasicInfoCard({ store, profiles }: BasicInfoCardProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    prefecture: store.prefecture,
    city: store.city,
    address: store.address,
    genre: store.genre,
    channel: store.channel,
    has_contact_form: store.has_contact_form,
    target_service: store.target_service,
    operator_type: store.operator_type,
    operator_name: store.operator_name,
    // Phase 7: text フィールドから user_id 参照へ移行
    assigned_planner_user_id: store.assigned_planner_user_id ?? "",
    assigned_sales_user_id: store.assigned_sales_user_id ?? "",
  });

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
    (
      e: ChangeEvent<HTMLInputElement | HTMLSelectElement>,
    ) =>
      set(key, e.target.value as (typeof form)[K]);

  const reset = () => {
    setForm({
      prefecture: store.prefecture,
      city: store.city,
      address: store.address,
      genre: store.genre,
      channel: store.channel,
      has_contact_form: store.has_contact_form,
      target_service: store.target_service,
      operator_type: store.operator_type,
      operator_name: store.operator_name,
      assigned_planner_user_id: store.assigned_planner_user_id ?? "",
      assigned_sales_user_id: store.assigned_sales_user_id ?? "",
    });
  };

  const onCancel = () => {
    reset();
    setEditing(false);
  };

  const onSave = () => {
    const patch: StorePatch = { ...form };
    startTransition(async () => {
      const result = await updateStorePatchAction(store.id, patch);
      if (result.ok) {
        toast.success(result.message ?? "更新しました");
        setEditing(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <Card>
      <Card.Header>
        <Card.Title>基本情報</Card.Title>
        {editing ? (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onCancel}
              disabled={pending}
            >
              <X className="h-3.5 w-3.5" /> キャンセル
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={onSave}
              disabled={pending}
            >
              <Save className="h-3.5 w-3.5" />
              {pending ? "保存中…" : "保存"}
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setEditing(true)}
          >
            <Pencil className="h-3.5 w-3.5" /> 編集
          </Button>
        )}
      </Card.Header>
      <Card.Body>
        {editing ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="都道府県" htmlFor="prefecture">
              <Input
                id="prefecture"
                value={form.prefecture}
                onChange={onText("prefecture")}
              />
            </FormField>
            <FormField label="市区町村" htmlFor="city">
              <Input id="city" value={form.city} onChange={onText("city")} />
            </FormField>
            <FormField
              label="住所・最寄り"
              htmlFor="address"
              className="md:col-span-2"
            >
              <Input
                id="address"
                value={form.address}
                onChange={onText("address")}
              />
            </FormField>
            <FormField label="業態" htmlFor="genre">
              <Input id="genre" value={form.genre} onChange={onText("genre")} />
            </FormField>
            <FormField label="問い合わせフォーム" htmlFor="has_contact_form">
              <Select
                id="has_contact_form"
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
            <FormField label="想定提案商材" className="md:col-span-2">
              <ServiceCheckboxGroup
                value={form.target_service}
                onChange={(csv) => set("target_service", csv)}
              />
            </FormField>
            <FormField label="運営者種別" htmlFor="operator_type">
              <Select
                id="operator_type"
                value={form.operator_type}
                onChange={onText("operator_type")}
              >
                {OPERATOR_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="運営者名" htmlFor="operator_name">
              <Input
                id="operator_name"
                value={form.operator_name}
                onChange={onText("operator_name")}
                placeholder="例: 株式会社○○ / 山田 太郎"
              />
            </FormField>
            <FormField label="プランナー" htmlFor="assigned_planner_user_id">
              <Select
                id="assigned_planner_user_id"
                value={form.assigned_planner_user_id}
                onChange={onText("assigned_planner_user_id")}
              >
                <option value="">未割当</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.display_name}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="営業担当" htmlFor="assigned_sales_user_id">
              <Select
                id="assigned_sales_user_id"
                value={form.assigned_sales_user_id}
                onChange={onText("assigned_sales_user_id")}
              >
                <option value="">未割当</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.display_name}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>
        ) : (
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Row label="エリア">
              {[store.prefecture, store.city].filter(Boolean).join(" / ") || "—"}
            </Row>
            <Row label="住所・最寄り">{store.address || "—"}</Row>
            <Row label="業態">{store.genre || "—"}</Row>
            <Row label="想定チャネル">
              <ChannelBadge channel={store.channel} />
            </Row>
            <Row label="問い合わせフォーム">{store.has_contact_form}</Row>
            <Row label="口コミ">
              {store.review_count > 0 ? (
                <span className="inline-flex items-center gap-2">
                  <StarRating value={store.review_avg} showValue />
                  <span className="text-xs text-muted-foreground">
                    {store.review_count} 件
                  </span>
                </span>
              ) : (
                "—"
              )}
            </Row>
            <Row label="想定提案商材">
              <ServiceTagList services={store.target_service} />
            </Row>
            <Row label="運営者種別">
              {store.operator_type !== "未設定" ? (
                store.operator_type
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </Row>
            <Row label="運営者名">{store.operator_name || "—"}</Row>
            <Row label="プランナー">
              {(store.assigned_planner_user_id &&
                profiles.find((p) => p.id === store.assigned_planner_user_id)
                  ?.display_name) ||
                "—"}
            </Row>
            <Row label="営業担当">
              {(store.assigned_sales_user_id &&
                profiles.find((p) => p.id === store.assigned_sales_user_id)
                  ?.display_name) ||
                "—"}
            </Row>
            <Row label="登録日">{formatDate(store.created_at)}</Row>
            <Row label="最終更新">{formatDate(store.updated_at)}</Row>
          </dl>
        )}
      </Card.Body>
    </Card>
  );
}
