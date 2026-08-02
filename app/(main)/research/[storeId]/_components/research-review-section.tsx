"use client";

/**
 * 53項目レビューセクション(Plan v3.2 §5.3)。カテゴリごとの折りたたみ(`<details>`)・
 * 「要確認のみ表示」フィルタ・「確認済みを全て採用」一括操作・レビュー完了
 * (Primary/Secondary)を提供する。
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "@/components/ui/toast";
import { ResearchItemCard, type DecideInput } from "./research-item-card";
import { NonReviewItemCard } from "./research-nonreview-card";
import {
  bulkAdoptConfirmedAction,
  completeReviewAction,
  recordReviewDecisionAction,
} from "@/lib/actions/research-run-actions";
import {
  BASIC_INFO_ITEM_BY_KEY,
  CATEGORY_LABELS,
  type CategoryKey,
} from "@/lib/domain/basic-info-items";
import {
  formatReviewProgressLabel,
  getReviewableItems,
  getUndecidedReviewableItems,
  isReviewableItem,
} from "@/lib/domain/research-review";
import { formatDateTime, nowIso } from "@/lib/utils/date";
import type { Store } from "@/types/store";
import type { ResearchItem, StoreResearchRun } from "@/types/research-run";

const STATUS_COUNT_LABELS: Record<string, string> = {
  confirmed: "確認済み",
  inferred: "推定",
  conflict: "競合",
  not_found: "確認できず",
  hearing_required: "ヒアリング必要",
  external_data_required: "外部データ必要",
};

interface Props {
  store: Store;
  run: StoreResearchRun;
  onUpdate: (next: StoreResearchRun) => void;
  onRestart: () => void;
  restarting: boolean;
}

export function ResearchReviewSection({ store, run, onUpdate, onRestart, restarting }: Props) {
  const router = useRouter();
  const items = useMemo(() => run.result ?? [], [run.result]);
  const [filterUnresolved, setFilterUnresolved] = useState(false);
  const [busy, startTransition] = useTransition();
  const [completing, startCompleting] = useTransition();

  const reviewCompleted = run.review_completed_at !== null;
  const reviewableItems = useMemo(() => getReviewableItems(items), [items]);
  const undecided = useMemo(
    () => getUndecidedReviewableItems(items, run.review_decisions),
    [items, run.review_decisions],
  );
  const canComplete = undecided.length === 0;

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of items) counts[item.status] = (counts[item.status] ?? 0) + 1;
    return counts;
  }, [items]);

  const grouped = useMemo(() => {
    const map = new Map<CategoryKey, ResearchItem[]>();
    for (const item of items) {
      const category = BASIC_INFO_ITEM_BY_KEY.get(item.key)?.category ?? "category_1_basic";
      const arr = map.get(category) ?? [];
      arr.push(item);
      map.set(category, arr);
    }
    return map;
  }, [items]);

  const isUnresolved = (item: ResearchItem): boolean => {
    if (item.status === "not_found" || item.status === "conflict") return true;
    if (!isReviewableItem(item)) return false;
    return run.review_decisions[item.key] === undefined;
  };

  const onDecide = (item: ResearchItem, input: DecideInput) => {
    if (reviewCompleted) return;
    startTransition(async () => {
      const res = await recordReviewDecisionAction({
        runId: run.id,
        storeId: store.id,
        itemKey: item.key,
        decision: input.decision,
        selectedCandidateId: input.selectedCandidateId,
        editedValue: input.editedValue,
      });
      if (res.ok) {
        onUpdate({ ...run, review_decisions: res.data.reviewDecisions });
      } else {
        toast.error(res.error);
      }
    });
  };

  const onBulkAdopt = () => {
    startTransition(async () => {
      const res = await bulkAdoptConfirmedAction({ runId: run.id, storeId: store.id });
      if (res.ok) {
        onUpdate({ ...run, review_decisions: res.data.reviewDecisions });
        if (res.data.adoptedCount > 0) toast.success(res.message ?? "採用しました");
      } else {
        toast.error(res.error);
      }
    });
  };

  const onComplete = (skipRemaining: boolean) => {
    startCompleting(async () => {
      const res = await completeReviewAction({ runId: run.id, storeId: store.id, skipRemaining });
      if (res.ok) {
        onUpdate({ ...run, review_completed_at: nowIso() });
        toast.success(res.message ?? "レビューを完了しました");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  const confirmedUndecidedCount = items.filter(
    (item) => item.status === "confirmed" && run.review_decisions[item.key] === undefined,
  ).length;

  return (
    <Card>
      <div className="flex flex-col items-start gap-2 px-5 py-4 border-b border-border">
        <div className="flex items-center gap-2 w-full justify-between">
          <h3 className="text-base font-semibold leading-none tracking-tight">
            AI店舗調査結果({formatDateTime(run.started_at)} 実施)
          </h3>
          <Badge tone={reviewCompleted ? "success" : "warning"}>
            {reviewCompleted ? "調査済み" : "要確認"}
          </Badge>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {Object.entries(statusCounts).map(([status, count]) => (
            <span key={status}>
              {STATUS_COUNT_LABELS[status] ?? status} {count}
            </span>
          ))}
        </div>
      </div>
      <Card.Body className="space-y-4">
        {run.warnings.length > 0 && (
          <div className="space-y-1 rounded-md border border-warning/40 bg-warning/10 p-3">
            {run.warnings.map((warning, i) => (
              <p key={i} className="flex items-start gap-1.5 text-xs text-warning">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>{warning}</span>
              </p>
            ))}
          </div>
        )}

        {!reviewCompleted && (
          <p className="text-sm text-muted-foreground">
            {formatReviewProgressLabel(
              items.length,
              reviewableItems.length,
              reviewableItems.length - undecided.length,
            )}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant={filterUnresolved ? "primary" : "outline"}
            onClick={() => setFilterUnresolved((v) => !v)}
          >
            要確認のみ表示
          </Button>
          {!reviewCompleted && confirmedUndecidedCount > 0 && (
            <Button type="button" size="sm" variant="secondary" onClick={onBulkAdopt} disabled={busy}>
              確認済みを全て採用({confirmedUndecidedCount}件)
            </Button>
          )}
        </div>

        {Array.from(grouped.entries()).map(([category, categoryItems]) => {
          const visibleItems = filterUnresolved ? categoryItems.filter(isUnresolved) : categoryItems;
          if (visibleItems.length === 0) return null;
          return (
            <details key={category} className="border border-border rounded-lg" open>
              <summary className="cursor-pointer select-none px-4 py-2.5 text-sm font-medium text-foreground bg-muted/30 rounded-lg">
                {CATEGORY_LABELS[category]}({categoryItems.length}項目)
              </summary>
              <div className="p-4 space-y-3">
                {visibleItems.map((item) => {
                  const label = BASIC_INFO_ITEM_BY_KEY.get(item.key)?.label ?? item.key;
                  return isReviewableItem(item) ? (
                    <ResearchItemCard
                      key={item.key}
                      item={item}
                      label={label}
                      sourceRegistry={run.source_registry}
                      decision={run.review_decisions[item.key]}
                      busy={busy}
                      onDecide={(input) => onDecide(item, input)}
                    />
                  ) : (
                    <NonReviewItemCard key={item.key} item={item} label={label} />
                  );
                })}
              </div>
            </details>
          );
        })}

        {reviewCompleted ? (
          <div className="flex justify-end pt-2 border-t border-border">
            <Button type="button" variant="outline" onClick={onRestart} disabled={restarting}>
              再調査する
            </Button>
          </div>
        ) : (
          <div className="flex flex-col items-end gap-2 pt-2 border-t border-border">
            {canComplete ? (
              <Button type="button" variant="primary" onClick={() => onComplete(false)} disabled={completing}>
                {completing ? "処理中…" : "レビュー完了"}
              </Button>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">あと{undecided.length}件が未対応です</p>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => onComplete(true)}
                  disabled={completing}
                >
                  {completing ? "処理中…" : "未確認項目をスキップしてレビュー完了"}
                </Button>
              </>
            )}
          </div>
        )}
      </Card.Body>
    </Card>
  );
}
