"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition, type ChangeEvent } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { optionsFromValues } from "@/components/ui/select-logic";
import { Button } from "@/components/ui/button";
import { PRIORITIES } from "@/types/store";
import type { Profile } from "@/types/profile";

const PRIORITY_OPTIONS = [
  { value: "", label: "優先度すべて" },
  ...optionsFromValues(PRIORITIES),
];

export interface PipelineFiltersProps {
  /** 担当者選択肢 (RSC で `getAllProfiles()` 経由で取得) */
  profiles: readonly Profile[];
}

export function PipelineFilters({ profiles }: PipelineFiltersProps) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    startTransition(() => {
      router.replace(`/pipeline?${next.toString()}`);
    });
  };

  return (
    <div className="bg-card border border-border rounded-lg shadow-card p-3 flex flex-wrap items-center gap-2">
      <div className="relative flex-1 min-w-[180px] basis-full sm:basis-auto">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/70" />
        <Input
          defaultValue={params.get("q") ?? ""}
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            update("q", e.target.value)
          }
          placeholder="店舗名で検索"
          className="pl-9"
          aria-label="検索"
        />
      </div>
      <Select
        width="auto"
        options={PRIORITY_OPTIONS}
        defaultValue={params.get("priority") ?? ""}
        onValueChange={(value) => update("priority", value)}
        aria-label="優先度"
        className="min-w-32"
      />
      <Select
        width="auto"
        options={[
          { value: "", label: "担当者すべて" },
          ...profiles.map((p) => ({ value: p.id, label: p.display_name })),
        ]}
        placeholder="不明な担当者"
        defaultValue={params.get("sales") ?? ""}
        onValueChange={(value) => update("sales", value)}
        aria-label="営業担当"
        className="min-w-32"
      />
      {params.size > 0 ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            startTransition(() => {
              router.replace("/pipeline");
            });
          }}
        >
          <X className="h-4 w-4" /> クリア
        </Button>
      ) : null}
      {pending ? (
        <span className="text-xs text-muted-foreground ml-auto">適用中…</span>
      ) : null}
    </div>
  );
}
