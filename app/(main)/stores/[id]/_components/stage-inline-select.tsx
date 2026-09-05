"use client";

import { useTransition, type ChangeEvent } from "react";
import { Select } from "@/components/ui/select";
import { updateStoreStageAction } from "@/lib/actions/store-actions";
import { STAGES, type StageId } from "@/types/stage";
import { toast } from "@/components/ui/toast";

export interface StageInlineSelectProps {
  storeId: string;
  current: StageId;
}

export function StageInlineSelect({
  storeId,
  current,
}: StageInlineSelectProps) {
  const [pending, startTransition] = useTransition();

  const handleChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value as StageId;
    if (next === current) return;
    startTransition(async () => {
      const result = await updateStoreStageAction(storeId, next);
      if (result.ok) {
        toast.success(result.message ?? "更新しました");
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <Select
      width="auto"
      value={current}
      onChange={handleChange}
      disabled={pending}
      aria-label="状態"
      className="min-w-32"
    >
      {STAGES.map((s) => (
        <option key={s.id} value={s.id}>
          {s.label}
        </option>
      ))}
    </Select>
  );
}
