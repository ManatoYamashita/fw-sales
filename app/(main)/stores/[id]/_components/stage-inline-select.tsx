"use client";

import { useOptimistic, useTransition } from "react";
import { Select } from "@/components/ui/select";
import { runAction } from "@/lib/client/run-action";
import { updateStoreStageAction } from "@/lib/actions/store-actions";
import { STAGES, type StageId } from "@/types/stage";

const STAGE_OPTIONS = STAGES.map((s) => ({ value: s.id, label: s.label }));

export interface StageInlineSelectProps {
  storeId: string;
  current: StageId;
}

export function StageInlineSelect({
  storeId,
  current,
}: StageInlineSelectProps) {
  const [pending, startTransition] = useTransition();
  // 保存が終わるまで選んだ段階を表示する。失敗すれば遷移の終了とともに元の段階へ戻る。
  const [shown, setShown] = useOptimistic(current);

  const handleChange = (value: string) => {
    const next = value as StageId;
    if (next === current) return;
    startTransition(async () => {
      setShown(next);
      await runAction(() => updateStoreStageAction(storeId, next), {
        success: "更新しました",
      });
    });
  };

  return (
    <Select
      width="auto"
      options={STAGE_OPTIONS}
      value={shown}
      onValueChange={handleChange}
      disabled={pending}
      aria-label="調査段階"
      className="min-w-32"
    />
  );
}
