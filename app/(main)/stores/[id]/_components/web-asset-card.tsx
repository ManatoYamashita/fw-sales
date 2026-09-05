"use client";

import { useState, useTransition, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Phone, Pencil, X, Save } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { toast } from "@/components/ui/toast";
import { updateStorePatchAction } from "@/lib/actions/store-actions";
import type { Store, StorePatch } from "@/types/store";

function LinkRow({ label, url }: { label: string; url: string }) {
  if (!url) {
    return (
      <li className="flex items-center justify-between gap-2 py-2 border-b border-border/60 last:border-b-0">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="text-xs text-muted-foreground/70">未設定</span>
      </li>
    );
  }
  return (
    <li className="flex items-center justify-between gap-2 py-2 border-b border-border/60 last:border-b-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-sm text-blue-700 hover:text-blue-800 max-w-[280px] truncate"
      >
        {url} <ExternalLink className="h-3 w-3 shrink-0" />
      </a>
    </li>
  );
}

export function WebAssetCard({ store }: { store: Store }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    map_url: store.map_url,
    site_url: store.site_url,
    instagram_url: store.instagram_url,
    phone: store.phone,
  });

  const onText =
    (key: keyof typeof form) =>
    (e: ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const onCancel = () => {
    setForm({
      map_url: store.map_url,
      site_url: store.site_url,
      instagram_url: store.instagram_url,
      phone: store.phone,
    });
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
        <Card.Title>WEB資産・連絡先</Card.Title>
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
      <Card.Body padding={editing ? "default" : "compact"}>
        {editing ? (
          <div className="grid grid-cols-1 gap-3">
            <FormField label="GoogleマップURL" htmlFor="map_url">
              <Input
                id="map_url"
                value={form.map_url}
                onChange={onText("map_url")}
              />
            </FormField>
            <FormField label="公式サイトURL" htmlFor="site_url">
              <Input
                id="site_url"
                type="url"
                value={form.site_url}
                onChange={onText("site_url")}
              />
            </FormField>
            <FormField label="Instagram URL" htmlFor="instagram_url">
              <Input
                id="instagram_url"
                type="url"
                value={form.instagram_url}
                onChange={onText("instagram_url")}
              />
            </FormField>
            <FormField label="電話番号" htmlFor="phone">
              <Input id="phone" value={form.phone} onChange={onText("phone")} />
            </FormField>
          </div>
        ) : (
          <ul>
            <LinkRow label="Googleマップ" url={store.map_url} />
            <LinkRow label="公式サイト" url={store.site_url} />
            <LinkRow label="Instagram" url={store.instagram_url} />
            <li className="flex items-center justify-between gap-2 py-2 border-b border-border/60 last:border-b-0">
              <span className="text-sm text-muted-foreground">電話番号</span>
              {store.phone ? (
                <a
                  href={`tel:${store.phone}`}
                  className="inline-flex items-center gap-1 text-sm text-blue-700 hover:text-blue-800"
                >
                  <Phone className="h-3 w-3" />
                  {store.phone}
                </a>
              ) : (
                <span className="text-xs text-muted-foreground/70">未設定</span>
              )}
            </li>
          </ul>
        )}
      </Card.Body>
    </Card>
  );
}
