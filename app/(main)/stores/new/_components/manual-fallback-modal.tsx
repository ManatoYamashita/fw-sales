"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Modal, ModalContent, ModalFooter } from "@/components/ui/modal";
import type { ApplyResult } from "@/lib/url-parser/types";

export type ManualFallbackReason = "parse_failed" | "places_not_found";

export interface ManualFallbackModalProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  /** URL 解析 + Places フォールバックで取得できた部分データ。各フィールドの初期値に流し込む。 */
  partial?: Partial<ApplyResult>;
  reason: ManualFallbackReason;
  /** 確定時のコールバック。入力された 5 フィールドのみを含む partial ApplyResult を渡す。 */
  onConfirm: (suggested: Partial<ApplyResult>) => void;
}

interface FormState {
  name: string;
  prefecture: string;
  city: string;
  phone: string;
  site_url: string;
}

const REASON_COPY: Record<
  ManualFallbackReason,
  { title: string; description: string }
> = {
  parse_failed: {
    title: "URL から店舗情報を取得できませんでした",
    description:
      "認識できない形式の URL でした。最低限の情報だけ手入力で補ってから登録に進めます。",
  },
  places_not_found: {
    title: "Google Maps でも店舗を特定できませんでした",
    description:
      "URL から一部の項目を取得しましたが、店舗を確定できませんでした。取得済みの値を初期値として表示しています。",
  },
};

/**
 * モーダル内部の入力フォーム。
 * `open=true` への切替時に親側で再マウントされることで、`useState` の initializer が
 * 再評価され、最新の `partial` が初期値として反映される (useEffect での同期を回避)。
 */
function FallbackFormBody({
  partial,
  reason,
  onCancel,
  onConfirm,
}: {
  partial?: Partial<ApplyResult>;
  reason: ManualFallbackReason;
  onCancel: () => void;
  onConfirm: (suggested: Partial<ApplyResult>) => void;
}) {
  const [form, setForm] = useState<FormState>(() => ({
    name: partial?.name ?? "",
    prefecture: partial?.prefecture ?? "",
    city: partial?.city ?? "",
    phone: partial?.phone ?? "",
    site_url: partial?.site_url ?? "",
  }));

  const copy = REASON_COPY[reason];

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    onConfirm({
      name: form.name.trim(),
      prefecture: form.prefecture.trim(),
      city: form.city.trim(),
      phone: form.phone.trim(),
      site_url: form.site_url.trim(),
    });
  };

  return (
    <ModalContent title={copy.title} description={copy.description} size="md">
      <form onSubmit={handleSubmit} className="space-y-3">
        <FormField label="店舗名" htmlFor="fallback-name" required>
          <Input
            id="fallback-name"
            value={form.name}
            onChange={(e) => update("name", e.target.value)}
            required
            autoFocus
          />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="都道府県" htmlFor="fallback-prefecture">
            <Input
              id="fallback-prefecture"
              value={form.prefecture}
              onChange={(e) => update("prefecture", e.target.value)}
              placeholder="東京都"
            />
          </FormField>
          <FormField label="市区町村" htmlFor="fallback-city">
            <Input
              id="fallback-city"
              value={form.city}
              onChange={(e) => update("city", e.target.value)}
              placeholder="渋谷区"
            />
          </FormField>
        </div>
        <FormField label="電話番号" htmlFor="fallback-phone">
          <Input
            id="fallback-phone"
            value={form.phone}
            onChange={(e) => update("phone", e.target.value)}
            placeholder="03-XXXX-XXXX"
            inputMode="tel"
          />
        </FormField>
        <FormField label="公式サイト URL" htmlFor="fallback-site-url">
          <Input
            id="fallback-site-url"
            value={form.site_url}
            onChange={(e) => update("site_url", e.target.value)}
            placeholder="https://example.com"
            type="url"
          />
        </FormField>
        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onCancel}>
            キャンセル
          </Button>
          <Button type="submit" variant="primary" disabled={!form.name.trim()}>
            下のフォームへ反映
          </Button>
        </ModalFooter>
      </form>
    </ModalContent>
  );
}

export function ManualFallbackModal({
  open,
  onOpenChange,
  partial,
  reason,
  onConfirm,
}: ManualFallbackModalProps) {
  const handleConfirm = (suggested: Partial<ApplyResult>) => {
    onConfirm(suggested);
    onOpenChange(false);
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      {/* open=true のときだけ Body をマウント。閉→開で内部 state が partial で再初期化される。 */}
      {open ? (
        <FallbackFormBody
          partial={partial}
          reason={reason}
          onCancel={() => onOpenChange(false)}
          onConfirm={handleConfirm}
        />
      ) : null}
    </Modal>
  );
}
