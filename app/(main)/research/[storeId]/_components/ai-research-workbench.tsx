"use client";

/**
 * `/research/[storeId]` のトップレベルオーケストレータ(PR4, Plan v3.2 §4, §5)。
 *
 * 主表示run(`selectPrimaryResearchRun`)の状態に応じて、開始カード / 進捗カード /
 * 失敗カード / レビューセクションのいずれかを描画する。営業資産生成セクションは
 * 常に表示する(Primary/Secondary導線の切替はセクション内部で行う、Plan §14)。
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Modal, ModalContent, ModalFooter } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import {
  getResearchRunStatusAction,
  startResearchRunAction,
} from "@/lib/actions/research-run-actions";
import { selectPrimaryResearchRun } from "@/lib/domain/research-review";
import { StartResearchCard } from "./start-research-card";
import { ResearchProgressCard } from "./research-progress-card";
import { ResearchFailedCard } from "./research-failed-card";
import { ResearchReviewSection } from "./research-review-section";
import { PastRunsList } from "./past-runs-list";
import { SalesAssetSection } from "./sales-asset-section";
import type { Store } from "@/types/store";
import type { StoreResearchRun } from "@/types/research-run";

export function AiResearchWorkbench({
  store,
  initialRuns,
}: {
  store: Store;
  initialRuns: StoreResearchRun[];
}) {
  const router = useRouter();
  const [runs, setRuns] = useState<StoreResearchRun[]>(initialRuns);
  const [starting, startStarting] = useTransition();
  const [confirmRestartOpen, setConfirmRestartOpen] = useState(false);

  const primaryRun = selectPrimaryResearchRun(runs);
  const pastRuns = primaryRun ? runs.filter((r) => r.id !== primaryRun.id) : runs;
  const hasUnreviewedSucceeded = runs.some(
    (r) => r.status === "succeeded" && r.review_completed_at === null,
  );

  const onRunUpdate = (updated: StoreResearchRun) => {
    setRuns((prev) => {
      const idx = prev.findIndex((r) => r.id === updated.id);
      if (idx === -1) return [updated, ...prev];
      const next = [...prev];
      next[idx] = updated;
      return next;
    });
  };

  const doStart = () => {
    startStarting(async () => {
      const res = await startResearchRunAction(store.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("AI店舗調査を開始しました");
      const statusRes = await getResearchRunStatusAction(res.data.runId);
      if (statusRes.ok) onRunUpdate(statusRes.data);
      router.refresh();
    });
  };

  const onStartClick = () => {
    if (primaryRun?.status === "running") return;
    if (hasUnreviewedSucceeded) {
      setConfirmRestartOpen(true);
      return;
    }
    doStart();
  };

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <div>
        <Link href="/research" className="text-xs text-muted-foreground hover:text-foreground">
          ← 調査
        </Link>
        <h2 className="text-xl md:text-2xl font-bold text-foreground mt-1">{store.name}</h2>
      </div>

      {!primaryRun && <StartResearchCard onStart={onStartClick} starting={starting} />}

      {primaryRun?.status === "running" && (
        <ResearchProgressCard run={primaryRun} onUpdate={onRunUpdate} />
      )}

      {primaryRun?.status === "failed" && (
        <ResearchFailedCard run={primaryRun} onRetry={onStartClick} retrying={starting} />
      )}

      {primaryRun?.status === "succeeded" && (
        <ResearchReviewSection
          store={store}
          run={primaryRun}
          onUpdate={onRunUpdate}
          onRestart={onStartClick}
          restarting={starting}
        />
      )}

      {pastRuns.length > 0 && <PastRunsList runs={pastRuns} />}

      <SalesAssetSection
        store={store}
        reviewCompleted={primaryRun?.status === "succeeded" && primaryRun.review_completed_at !== null}
      />

      <Modal open={confirmRestartOpen} onOpenChange={setConfirmRestartOpen}>
        <ModalContent
          title="再調査しますか?"
          description="まだレビューが完了していない調査結果があります。再調査すると新しい結果が追加されます。今の結果を先にレビューしますか?"
        >
          <ModalFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmRestartOpen(false)}>
              今の結果をレビューする
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => {
                setConfirmRestartOpen(false);
                doStart();
              }}
            >
              それでも再調査する
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}
