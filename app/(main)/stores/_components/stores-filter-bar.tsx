"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition, type ChangeEvent } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { STAGES } from "@/types/stage";
import { CHANNELS, PRIORITIES } from "@/types/store";

export function StoresFilterBar() {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    startTransition(() => {
      router.replace(`/stores?${next.toString()}`);
    });
  };

  const clear = () => {
    startTransition(() => {
      router.replace("/stores");
    });
  };

  const onSearch = (e: ChangeEvent<HTMLInputElement>) =>
    update("q", e.target.value);

  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-card p-3 flex flex-wrap items-center gap-2">
      <div className="relative flex-1 min-w-[180px]">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input
          defaultValue={params.get("q") ?? ""}
          onChange={onSearch}
          placeholder="店舗名・エリア・業態で検索"
          className="pl-9"
          aria-label="検索"
        />
      </div>

      <Select
        defaultValue={params.get("stage") ?? ""}
        onChange={(e) => update("stage", e.target.value)}
        aria-label="ステージで絞り込み"
        className="w-auto min-w-36"
      >
        <option value="">すべてのステージ</option>
        {STAGES.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </Select>

      <Select
        defaultValue={params.get("channel") ?? ""}
        onChange={(e) => update("channel", e.target.value)}
        aria-label="チャネルで絞り込み"
        className="w-auto min-w-36"
      >
        <option value="">すべてのチャネル</option>
        {CHANNELS.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </Select>

      <Select
        defaultValue={params.get("priority") ?? ""}
        onChange={(e) => update("priority", e.target.value)}
        aria-label="優先度で絞り込み"
        className="w-auto min-w-28"
      >
        <option value="">すべての優先度</option>
        {PRIORITIES.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </Select>

      {params.size > 0 ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={clear}
          aria-label="フィルタをクリア"
        >
          <X className="h-4 w-4" /> クリア
        </Button>
      ) : null}

      {pending ? (
        <span className="text-xs text-slate-500 ml-auto">適用中…</span>
      ) : null}
    </div>
  );
}
