"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, XCircle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import {
  retryDeepResearchAction,
  cancelDeepResearchJobAction,
  deleteDeepResearchJobAction,
} from "@/lib/actions/deep-research-actions";
import type { JobStatus } from "@/types/deep-research";

interface JobActionButtonsProps {
  jobId: string;
  status: JobStatus;
}

export function JobActionButtons({ jobId, status }: JobActionButtonsProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const canCancel = status === "queued" || status === "researching";
  const canRetry = status === "failed";
  const canDelete = status === "failed";

  const handle = (
    action: (id: string) => Promise<{ ok: boolean; error?: string; [key: string]: unknown }>,
    successMessage: string,
    redirectTo?: string,
  ) => {
    startTransition(async () => {
      const result = await action(jobId);
      if (result.ok) {
        toast.success(successMessage);
        if (redirectTo) {
          router.push(redirectTo);
        } else {
          router.refresh();
        }
      } else {
        toast.error(result.error ?? "操作に失敗しました");
      }
    });
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {canCancel && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => handle(cancelDeepResearchJobAction, "キャンセルしました")}
          disabled={pending}
        >
          {pending ? <Spinner /> : <XCircle className="h-3.5 w-3.5" />}
          キャンセル
        </Button>
      )}
      {canRetry && (
        <Button
          variant="default"
          size="sm"
          onClick={() => handle(retryDeepResearchAction, "再投入しました")}
          disabled={pending}
        >
          {pending ? <Spinner /> : <RefreshCw className="h-3.5 w-3.5" />}
          再投入
        </Button>
      )}
      {canDelete && (
        <Button
          variant="destructive"
          size="sm"
          onClick={() => handle(deleteDeepResearchJobAction, "削除しました", "/research")}
          disabled={pending}
        >
          {pending ? <Spinner /> : <Trash2 className="h-3.5 w-3.5" />}
          削除
        </Button>
      )}
    </div>
  );
}
