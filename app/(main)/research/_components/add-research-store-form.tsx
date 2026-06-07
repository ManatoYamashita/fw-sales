"use client";

import { useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createStoreAction } from "@/lib/actions/store-actions";
import { Card } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";

/**
 * 調査対象を 1 件登録する簡易フォーム。
 *
 * createStoreAction は stage 未指定時に「未調査」を付与するため、本フォームから登録した
 * 店舗はそのまま「調査待ち」タブ(stage=未調査)に並ぶ。必須は店舗名のみで、所在地・業態・URL は
 * 任意(Gemini の DeepResearch が公開情報からベストエフォートで補完する前提)。
 */
export function AddResearchStoreForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const submit = (formData: FormData) => {
    startTransition(async () => {
      const result = await createStoreAction(null, formData);
      if (result.ok) {
        toast.success(result.message ?? "調査対象を登録しました");
        formRef.current?.reset();
        // 「調査待ち」タブへ即時反映(getResearchQueue は CACHE_TAGS.stores で失効済み)。
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <Card>
      <Card.Header>
        <Card.Title>調査対象を追加</Card.Title>
      </Card.Header>
      <Card.Body>
        <form ref={formRef} action={submit} className="space-y-4">
          <FormField label="店舗名" required htmlFor="research-store-name">
            <Input
              id="research-store-name"
              name="name"
              required
              placeholder="例: 導楽"
            />
          </FormField>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="都道府県" htmlFor="research-store-prefecture">
              <Input
                id="research-store-prefecture"
                name="prefecture"
                placeholder="例: 神奈川県"
              />
            </FormField>
            <FormField label="市区町村" htmlFor="research-store-city">
              <Input
                id="research-store-city"
                name="city"
                placeholder="例: 川崎市中原区"
              />
            </FormField>
            <FormField label="業態" htmlFor="research-store-genre">
              <Input
                id="research-store-genre"
                name="genre"
                placeholder="例: 居酒屋"
              />
            </FormField>
            <FormField label="公式サイトURL" htmlFor="research-store-site-url">
              <Input
                id="research-store-site-url"
                name="site_url"
                type="url"
                placeholder="https://example.com"
              />
            </FormField>
          </div>
          <div className="flex justify-end">
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? "登録中…" : "調査待ちに追加"}
            </Button>
          </div>
        </form>
      </Card.Body>
    </Card>
  );
}
