"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { toast } from "@/components/ui/toast";
import { setGemUrlAction } from "@/lib/actions/app-settings-actions";

/**
 * 調査用 Gem (Gemini GUI) の URL を保存するフォーム。
 *
 * 空入力で保存するとクリア (空文字保存) になる。保存後は `revalidateTag` 済みの
 * 値を反映するため `router.refresh()` する。
 */
export function GemUrlForm({ initialUrl }: { initialUrl: string | null }) {
  const router = useRouter();
  const [url, setUrl] = useState(initialUrl ?? "");
  const [pending, startTransition] = useTransition();

  const onSave = () => {
    const fd = new FormData();
    fd.set("gem_url", url);
    startTransition(async () => {
      const result = await setGemUrlAction(fd);
      if (result.ok) {
        toast.success(result.message ?? "保存しました");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <div className="space-y-3">
      <FormField label="Gem URL" htmlFor="gem_url">
        <Input
          id="gem_url"
          type="url"
          inputMode="url"
          placeholder="https://gemini.google.com/gem/..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </FormField>
      <div className="flex items-center gap-2">
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
        <p className="text-xs text-muted-foreground">
          空欄で保存するとクリアされます
        </p>
      </div>
    </div>
  );
}
