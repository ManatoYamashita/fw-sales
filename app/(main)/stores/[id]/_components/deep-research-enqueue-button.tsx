"use client";

/**
 * Deep Research キュー登録 CTA (deep-research-pipeline spec #43, Task 5.2)
 *
 * 表示分岐 (currentJob.status に応じて):
 * - null               → 「Deep Research を実行」CTA active
 * - queued/researching/structuring → 進行中バッジ表示 + CTA disabled
 * - failed             → 「再投入」ラベル CTA active (retryDeepResearchAction を呼ぶ)
 *
 * 関連: requirements.md §1.1, §5.1, §5.5
 */

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { ResearchStatusBadge } from "@/components/feature/research-status-badge";
import { DeepResearchJobDetailLink } from "./deep-research-job-detail-link";
import {
  enqueueDeepResearchAction,
  retryDeepResearchAction,
} from "@/lib/actions/deep-research-actions";
import { isPendingStatus } from "@/types/deep-research";
import type { DeepResearchJob } from "@/types/deep-research";

interface DeepResearchEnqueueButtonProps {
  storeId: string;
  currentJob: DeepResearchJob | null;
  /** 調査キューのジョブ詳細 (`/research/jobs/[id]`) へのリンク用 */
  jobDetailId?: string | null;
}

export function DeepResearchEnqueueButton({
  storeId,
  currentJob,
  jobDetailId,
}: DeepResearchEnqueueButtonProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const isInflight =
    currentJob !== null && isPendingStatus(currentJob.status);
  const isFailed = currentJob?.status === "failed";

  const handleEnqueue = () => {
    startTransition(async () => {
      const result = await enqueueDeepResearchAction(storeId);
      if (result.ok) {
        toast.success("Deep Research をキューに登録しました");
        // 投入したジョブの進捗ページへ遷移し、ライブ進捗を確認できるようにする。
        router.push(`/research/jobs/${result.data.jobId}`);
      } else {
        toast.error(result.error);
      }
    });
  };

  const handleRetry = () => {
    if (!currentJob) return;
    startTransition(async () => {
      const result = await retryDeepResearchAction(currentJob.id);
      if (result.ok) {
        toast.success("再投入しました。新規ジョブをキューに登録しました");
        // 再投入で作成した新規ジョブの進捗ページへ遷移する。
        router.push(`/research/jobs/${result.data.newJobId}`);
      } else {
        toast.error(result.error);
      }
    });
  };

  const detailLink =
    jobDetailId ? (
      <DeepResearchJobDetailLink jobId={jobDetailId} className="shrink-0" />
    ) : null;

  if (isInflight && currentJob) {
    return (
      <div className="flex items-center gap-2 flex-wrap justify-end">
        <ResearchStatusBadge status={currentJob.status} />
        {detailLink}
        <Button variant="outline" size="md" disabled>
          {pending ? <Spinner /> : <Sparkles className="h-4 w-4" />}
          実行中
        </Button>
      </div>
    );
  }

  if (isFailed && currentJob) {
    return (
      <div className="flex items-center gap-2 flex-wrap justify-end">
        <ResearchStatusBadge status="failed" />
        {detailLink}
        <Button
          variant="default"
          size="md"
          onClick={handleRetry}
          disabled={pending}
        >
          {pending ? <Spinner /> : <RefreshCw className="h-4 w-4" />}
          再投入
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-wrap justify-end">
      {detailLink}
      <Button
        variant="default"
        size="md"
        onClick={handleEnqueue}
        disabled={pending}
      >
        {pending ? <Spinner /> : <Sparkles className="h-4 w-4" />}
        Deep Research を実行
      </Button>
    </div>
  );
}
