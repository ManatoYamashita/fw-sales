"use client";

/**
 * 53項目レビューセクション(Plan v3.2 §5.3)。カテゴリごとの折りたたみ(`<details>`)・
 * 「要確認のみ表示」フィルタ・レビュー完了(Primary/Secondary)を提供する。
 *
 * ## feat/ai-research-quality-ux-hardening での変更(Plan §12 / §13)
 *
 * 実運用の操作モデルは「AIが具体的に調査した値は基本採用。明らかにおかしいものだけ
 * 編集/却下。skipはほぼ使わない」だが、旧UIは逆に「全項目に個別判断を要求し、
 * 残りは『未確認項目をスキップしてレビュー完了』」というモデルだった。しかも
 * 一括操作(`bulkAdoptConfirmedAction`)は `inferred` を対象外にしていたため、
 * それを使っても未判断が必ず残り、**未対応がある間は primary ボタンが画面上に
 * 1つも存在しない**状態になっていた。
 *
 * - Primary CTA を「残りN件を採用して調査完了」へ変更(単一の atomic Server Action)
 * - 採用対象の内訳(確認済み / 推定)を押す前に表示
 * - `conflict` が未判断なら Primary を block(候補選択なしで自動採用しない)
 * - 完了操作を **sticky footer**(`<Card>` の外)へ移動。53項目で縦に長く、
 *   旧レイアウトでは画面下までスクロールしないと完了できなかった
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
  adoptRemainingAndCompleteReviewAction,
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
  summarizeUndecided,
} from "@/lib/domain/research-review";
import { formatDateTime } from "@/lib/utils/date";
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

  /**
   * Primary CTA: 未判断の confirmed / inferred をまとめて採用し、レビューを完了する
   * (feat/ai-research-quality-ux-hardening、Plan §12)。
   *
   * 実運用は「AIが調査した値は基本採用。おかしいものだけ編集/却下」であり、
   * 旧UIの「全項目に個別判断 → 残りをスキップして完了」とは逆だった。
   * conflict が残っている場合はサーバー側で拒否される(候補選択が必須)。
   *
   * 成功レスポンスは server-returned authoritative state をそのまま使う。
   * クライアント側で `nowIso()` を捏造したり decisions を再構築したりしない。
   */
  const onAdoptRemainingAndComplete = () => {
    startCompleting(async () => {
      const res = await adoptRemainingAndCompleteReviewAction({ runId: run.id, storeId: store.id });
      if (res.ok) {
        onUpdate({
          ...run,
          review_decisions: res.data.reviewDecisions,
          review_completed_at: res.data.reviewCompletedAt,
        });
        toast.success(res.message ?? "レビューを完了しました");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  /** Secondary CTA: 未対応項目を反映せず、判断済みの内容だけで完了する。 */
  const onCompleteDecidedOnly = () => {
    startCompleting(async () => {
      const res = await completeReviewAction({
        runId: run.id,
        storeId: store.id,
        skipRemaining: true,
      });
      if (res.ok) {
        toast.success(res.message ?? "レビューを完了しました");
        // `completeReviewAction` は decisions を返さないため、サーバー側の確定状態は
        // `router.refresh()` の再取得に委ねる(クライアントで値を捏造しない)。
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  /** Primary CTA で何が採用されるかの内訳(押す前に見えるようにする、Plan §12.1.1)。 */
  const undecidedSummary = useMemo(
    () => summarizeUndecided(items, run.review_decisions),
    [items, run.review_decisions],
  );
  const blockedByConflict = undecidedSummary.conflict > 0;

  return (
    <>
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
            {!reviewCompleted && blockedByConflict && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setFilterUnresolved(true)}
              >
                競合{undecidedSummary.conflict}件へ移動
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
                        busy={busy || completing}
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

          {reviewCompleted && (
            <div className="flex justify-end pt-2 border-t border-border">
              <Button type="button" variant="outline" onClick={onRestart} disabled={restarting}>
                再調査する
              </Button>
            </div>
          )}
          {/* 未完了時の完了操作は sticky footer(Card の外)へ移した。53項目・8カテゴリで
              縦に長く、旧レイアウトでは画面下までスクロールしないと完了できなかったため。 */}
          {!reviewCompleted && <div className="h-2" aria-hidden />}
        </Card.Body>
      </Card>
      {!reviewCompleted && (
        <ReviewCompletionFooter
          summary={undecidedSummary}
          decidedCount={reviewableItems.length - undecided.length}
          busy={busy}
          completing={completing}
          onAdoptRemaining={onAdoptRemainingAndComplete}
          onCompleteDecidedOnly={onCompleteDecidedOnly}
        />
      )}
    </>
  );
}

/**
 * レビュー完了操作の sticky footer(feat/ai-research-quality-ux-hardening、Plan §13)。
 *
 * **`<Card>` は `overflow-hidden`(`components/ui/card.tsx`)なので Card の内側では
 * sticky が効かない。** 既存の先例(`stores-table-view.tsx` / `area-search-results.tsx`)
 * と同じく Card の外side に置く。クラス列も先例をそのまま踏襲する
 * (`fixed` ではなく `sticky` にすることで、サイドバー折りたたみでも左端がズレない)。
 */
function ReviewCompletionFooter({
  summary,
  decidedCount,
  busy,
  completing,
  onAdoptRemaining,
  onCompleteDecidedOnly,
}: {
  summary: ReturnType<typeof summarizeUndecided>;
  decidedCount: number;
  busy: boolean;
  completing: boolean;
  onAdoptRemaining: () => void;
  onCompleteDecidedOnly: () => void;
}) {
  const blockedByConflict = summary.conflict > 0;
  const disabled = busy || completing;

  return (
    <div
      role="region"
      aria-label="レビュー完了操作"
      className="sticky bottom-0 z-30 flex flex-wrap items-center gap-2 border-t border-border bg-background/80 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md"
    >
      <div className="flex flex-col gap-0.5 text-xs text-muted-foreground" aria-live="polite">
        <span>
          採用済み {decidedCount} ・ 未対応 {summary.total}
          {blockedByConflict ? ` ・ 要選択 ${summary.conflict}` : ""}
        </span>
        {summary.adoptable > 0 && (
          <span>
            残り: 確認済み {summary.confirmed}・推定 {summary.inferred}
          </span>
        )}
        {blockedByConflict && (
          <span className="text-warning">
            候補を選択する必要がある項目が{summary.conflict}件あります
          </span>
        )}
      </div>

      <div className="ml-auto flex flex-col items-stretch gap-1 sm:items-end">
        <Button
          type="button"
          variant="primary"
          className="w-full sm:w-auto"
          onClick={onAdoptRemaining}
          disabled={disabled || blockedByConflict}
        >
          {completing
            ? "処理中…"
            : summary.adoptable > 0
              ? `残り${summary.adoptable}件を採用して調査完了`
              : "レビュー完了"}
        </Button>
        {summary.total > 0 && (
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full sm:w-auto"
              onClick={onCompleteDecidedOnly}
              disabled={disabled}
            >
              判断済みの内容だけで完了
            </Button>
            <span className="text-[11px] text-muted-foreground sm:text-right">
              未対応項目は反映されません
            </span>
          </>
        )}
      </div>
    </div>
  );
}
