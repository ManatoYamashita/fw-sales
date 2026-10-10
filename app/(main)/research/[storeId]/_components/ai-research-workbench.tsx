"use client";

/**
 * `/research/[storeId]` のトップレベルオーケストレータ(PR4, Plan v3.2 §4, §5)。
 *
 * 主表示run(`selectPrimaryResearchRun`)の状態に応じて、開始カード / 進捗カード /
 * 失敗カード / レビューセクションのいずれかを描画する。営業資産生成セクションは
 * 常に表示する(Primary/Secondary導線の切替はセクション内部で行う、Plan §14)。
 *
 * Issue #300: 見出し直下に推奨手順 (① AI調査 → ② レビュー → ③ 営業資産を生成) と
 * 現在地を出す。営業資産の生成はこのページの ③ が唯一の入口。
 */

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Modal, ModalContent, ModalFooter } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { runAction } from "@/lib/client/run-action";
import {
  getResearchRunStatusAction,
  startResearchRunAction,
} from "@/lib/actions/research-run-actions";
import { isRunStuck, selectPrimaryResearchRun } from "@/lib/domain/research-review";
import {
  getResearchFlowSteps,
  getSalesAssetGenerationContext,
} from "@/lib/domain/research-flow";
import { decodeHashId } from "@/lib/utils/hash-id";
import { ResearchFlowSteps } from "./research-flow-steps";
import { StartResearchCard } from "./start-research-card";
import { ResearchProgressCard } from "./research-progress-card";
import { ResearchFailedCard } from "./research-failed-card";
import { ResearchReviewSection } from "./research-review-section";
import { PastRunsList } from "./past-runs-list";
import { SalesAssetSection } from "./sales-asset-section";
import type { Store } from "@/types/store";
import type { StoreResearchRun } from "@/types/research-run";

/** ② レビューの着地点。生成セクションの「レビューへ戻る」が使う。 */
const REVIEW_SECTION_ID = "research-review";

export function AiResearchWorkbench({
  store,
  initialRuns,
  isApiKeyConfigured,
}: {
  store: Store;
  initialRuns: StoreResearchRun[];
  isApiKeyConfigured: boolean;
}) {
  const router = useRouter();
  const [runs, setRuns] = useState<StoreResearchRun[]>(initialRuns);
  const [starting, startStarting] = useTransition();
  const [confirmRestartOpen, setConfirmRestartOpen] = useState(false);

  const primaryRun = selectPrimaryResearchRun(runs);
  const pastRuns = primaryRun ? runs.filter((r) => r.id !== primaryRun.id) : runs;
  const flowSteps = getResearchFlowSteps(primaryRun, store.ai_analysis_result !== null);
  const generationContext = getSalesAssetGenerationContext(
    primaryRun,
    runs.some((r) => r.review_completed_at !== null),
  );
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
      const res = await runAction(() => startResearchRunAction(store.id), {
        success: () => "AI店舗調査を開始しました",
      });
      if (!res?.ok) return;
      // 状態の取得に失敗しても調査自体は始まっている。画面の再取得とポーリングに任せる。
      const statusRes = await getResearchRunStatusAction(res.data.runId).catch(() => null);
      if (statusRes?.ok) onRunUpdate(statusRes.data);
      router.refresh();
    });
  };

  const onStartClick = () => {
    // running中でも、想定時間を超えた stuck run(Plan §17)なら再調査を許可する。
    // サーバ側(startResearchRunAction)も同じ判定でstuck runをfailedへ倒してから
    // 新規runを作成するため、ここでの早期returnは単なるUXの無駄クリック防止。
    if (primaryRun?.status === "running" && !isRunStuck(primaryRun, new Date().toISOString())) {
      return;
    }
    if (hasUnreviewedSucceeded) {
      setConfirmRestartOpen(true);
      return;
    }
    doStart();
  };

  // 店舗詳細の「営業資産を更新」などが付ける `#sales-assets` へ着地させる。
  // このセグメントは loading.tsx の Suspense 越しに描画されるため、遷移時点では対象要素が
  // まだ無く、Next.js のハッシュスクロールが空振りする (実測で scrollY 0 のまま)。
  useEffect(() => {
    const id = decodeHashId(window.location.hash);
    if (id === null) return;
    document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, []);

  const onJumpToReview = () => {
    const el = document.getElementById(REVIEW_SECTION_ID);
    if (!el) return;
    el.scrollIntoView({ block: "start" });
    // 視線だけでなくフォーカスも移し、キーボード・支援技術の利用者を同じ場所へ運ぶ。
    el.focus({ preventScroll: true });
  };

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <div>
        <Link href="/research" className="text-xs text-muted-foreground hover:text-foreground">
          ← 調査
        </Link>
        <h1 className="text-xl md:text-2xl font-bold text-foreground mt-1">{store.name}</h1>
      </div>

      <ResearchFlowSteps steps={flowSteps} />

      {!primaryRun && <StartResearchCard onStart={onStartClick} starting={starting} />}

      {primaryRun?.status === "running" && (
        <ResearchProgressCard
          run={primaryRun}
          onUpdate={onRunUpdate}
          onRetryStuck={onStartClick}
          retrying={starting}
        />
      )}

      {primaryRun?.status === "failed" && (
        <ResearchFailedCard run={primaryRun} onRetry={onStartClick} retrying={starting} />
      )}

      {primaryRun?.status === "succeeded" && (
        <section
          id={REVIEW_SECTION_ID}
          tabIndex={-1}
          aria-label="② レビュー"
          className="scroll-mt-24 focus:outline-none"
        >
          <ResearchReviewSection
            store={store}
            run={primaryRun}
            onUpdate={onRunUpdate}
            onRestart={onStartClick}
            restarting={starting}
          />
        </section>
      )}

      {pastRuns.length > 0 && <PastRunsList runs={pastRuns} />}

      <SalesAssetSection
        store={store}
        context={generationContext}
        isApiKeyConfigured={isApiKeyConfigured}
        onJumpToReview={onJumpToReview}
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
