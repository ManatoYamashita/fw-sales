"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition, type ChangeEvent } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { PRIORITIES } from "@/types/store";
import type { Profile } from "@/types/profile";

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
        defaultValue={params.get("priority") ?? ""}
        onChange={(e) => update("priority", e.target.value)}
        aria-label="優先度"
        className="min-w-32"
      >
        <option value="">優先度すべて</option>
        {PRIORITIES.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </Select>
      <Select
        width="auto"
        defaultValue={params.get("sales") ?? ""}
        onChange={(e) => update("sales", e.target.value)}
        aria-label="営業担当"
        className="min-w-32"
      >
        <option value="">担当者すべて</option>
        {profiles.map((p) => (
          <option key={p.id} value={p.id}>
            {p.display_name}
          </option>
        ))}
      </Select>
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
