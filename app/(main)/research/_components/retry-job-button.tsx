"use client";

/**
 * Deep Research キューページ「失敗」タブの 1 行用 retry ボタン。
 *
 * `deep-research-enqueue-button.tsx` の retry セクションを抽出した小型版。
 * `useTransition` + `toast` + `router.refresh()` で `retryDeepResearchAction` を呼ぶ。
 *
 * 関連: requirements.md §5.5, design.md §retryDeepResearchAction
 */

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { retryDeepResearchAction } from "@/lib/actions/deep-research-actions";

interface RetryJobButtonProps {
  jobId: string;
}

export function RetryJobButton({ jobId }: RetryJobButtonProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const handleRetry = () => {
    startTransition(async () => {
      const result = await retryDeepResearchAction(jobId);
      if (result.ok) {
        toast.success("再投入しました");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleRetry}
      disabled={pending}
    >
      {pending ? <Spinner /> : <RefreshCw className="h-3.5 w-3.5" />}
      再投入
    </Button>
  );
}
