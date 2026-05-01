"use client";

import { useState, useTransition } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal, ModalContent } from "@/components/ui/modal";
import { StageBadge } from "@/components/feature/stage-badge";
import { updateStoreStageAction } from "@/lib/actions/store-actions";
import { STAGES, type StageId } from "@/types/stage";
import { toast } from "@/components/ui/toast";

export interface StageChangeButtonProps {
  storeId: string;
  current: StageId;
}

export function StageChangeButton({ storeId, current }: StageChangeButtonProps) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const change = (next: StageId) => {
    if (next === current) {
      setOpen(false);
      return;
    }
    startTransition(async () => {
      const result = await updateStoreStageAction(storeId, next);
      if (result.ok) {
        toast.success(result.message ?? "更新しました");
        setOpen(false);
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <Modal open={open} onOpenChange={setOpen}>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="gap-1.5"
      >
        <StageBadge stage={current} />
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/70" />
      </Button>
      <ModalContent title="ステージを変更" size="sm">
        <div className="grid grid-cols-2 gap-2">
          {STAGES.map((stage) => {
            const active = stage.id === current;
            return (
              <button
                key={stage.id}
                type="button"
                onClick={() => change(stage.id)}
                disabled={pending}
                className={
                  active
                    ? "px-3 py-2 rounded-md text-xs font-medium border-2 border-blue-600 text-blue-700 bg-blue-50"
                    : "px-3 py-2 rounded-md text-xs font-medium border border-border text-foreground hover:border-input hover:bg-muted/40 disabled:opacity-50"
                }
                style={
                  active ? undefined : { background: stage.bg, color: stage.color }
                }
              >
                {stage.label}
              </button>
            );
          })}
        </div>
      </ModalContent>
    </Modal>
  );
}
