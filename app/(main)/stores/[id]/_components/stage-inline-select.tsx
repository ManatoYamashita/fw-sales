"use client";

import { useTransition, type ChangeEvent } from "react";
import { Select } from "@/components/ui/select";
import { runAction } from "@/lib/client/run-action";
import { updateStoreStageAction } from "@/lib/actions/store-actions";
import { STAGES, type StageId } from "@/types/stage";

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
      await runAction(() => updateStoreStageAction(storeId, next), {
        success: "更新しました",
      });
    });
  };

  return (
    <Select
      width="auto"
      value={current}
      onChange={handleChange}
      disabled={pending}
      aria-label="調査段階"
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
