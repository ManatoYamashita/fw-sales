"use client";

import { useState, useTransition, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { MapPin, Pencil, X, Save } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { EmptyState } from "@/components/ui/empty-state";
import { toast } from "@/components/ui/toast";
import { updateStorePatchAction } from "@/lib/actions/store-actions";
import type { Store, StorePatch } from "@/types/store";

function parseCoord(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const num = Number(trimmed);
  return Number.isFinite(num) ? num : null;
}

export function MapEmbedCard({ store }: { store: Store }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    lat: store.lat === null ? "" : String(store.lat),
    lng: store.lng === null ? "" : String(store.lng),
  });

  const onText =
    (key: keyof typeof form) =>
    (e: ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const onCancel = () => {
    setForm({
      lat: store.lat === null ? "" : String(store.lat),
      lng: store.lng === null ? "" : String(store.lng),
    });
    setEditing(false);
  };

  const onSave = () => {
    const lat = parseCoord(form.lat);
    const lng = parseCoord(form.lng);
    if ((form.lat.trim() !== "" && lat === null) || (form.lng.trim() !== "" && lng === null)) {
      toast.error("緯度・経度は数値で入力してください");
      return;
    }
    const patch: StorePatch = { lat, lng };
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

  const hasCoords =
    typeof store.lat === "number" && typeof store.lng === "number";

  return (
    <Card>
      <Card.Header>
        <Card.Title>所在地マップ</Card.Title>
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
            <Pencil className="h-3.5 w-3.5" /> 緯度経度を編集
          </Button>
        )}
      </Card.Header>
      <Card.Body padding={editing ? "default" : "flush"}>
        {editing ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <FormField label="緯度 (lat)" htmlFor="lat">
              <Input
                id="lat"
                type="number"
                step="any"
                value={form.lat}
                onChange={onText("lat")}
                placeholder="例: 35.5836"
              />
            </FormField>
            <FormField label="経度 (lng)" htmlFor="lng">
              <Input
                id="lng"
                type="number"
                step="any"
                value={form.lng}
                onChange={onText("lng")}
                placeholder="例: 139.6571"
              />
            </FormField>
          </div>
        ) : hasCoords ? (
          <div>
            <div className="aspect-video w-full">
              <iframe
                title={`${store.name} の所在地マップ`}
                src={`https://maps.google.com/maps?q=${store.lat},${store.lng}&z=16&output=embed`}
                className="w-full h-full border-0"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />
            </div>
            <p className="px-5 py-2 text-xs text-muted-foreground border-t border-border">
              緯度 {store.lat} / 経度 {store.lng}
            </p>
          </div>
        ) : (
          <div className="px-5 py-4">
            <EmptyState
              icon={<MapPin />}
              title="緯度・経度が未登録です"
              description="エリア検索による自動取得後、または「緯度経度を編集」から手動入力で表示できます。"
            />
          </div>
        )}
      </Card.Body>
    </Card>
  );
}
