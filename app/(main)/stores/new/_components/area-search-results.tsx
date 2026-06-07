"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { PlaceResultList } from "./place-result-list";
import { bulkAddStoresFromPlacesAction } from "@/lib/actions/area-search-actions";
import type { PlaceWithMatch } from "@/lib/places/types";

export interface AreaSearchResultsProps {
  results: readonly PlaceWithMatch[];
}

/**
 * エリア検索結果の一覧 + 一括登録コントロール。
 * 親の `AreaSearchPanel` から検索結果を受け取り、選択/登録の状態は内部で完結する。
 */
export function AreaSearchResults({ results }: AreaSearchResultsProps) {
  const [addedIds, setAddedIds] = useState<ReadonlySet<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [bulkResult, setBulkResult] = useState<{
    added: number;
    failed: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBulkPending, startBulkTransition] = useTransition();
  const router = useRouter();

  const handleAdded = (placeId: string) => {
    setAddedIds((prev) => new Set([...prev, placeId]));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(placeId);
      return next;
    });
  };

  const handleToggle = (placeId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(placeId)) {
        next.delete(placeId);
      } else {
        next.add(placeId);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    const eligible = results
      .filter(
        ({ place, matchedStore }) =>
          matchedStore === null && !addedIds.has(place.placeId),
      )
      .map(({ place }) => place.placeId);
    setSelectedIds(new Set(eligible));
  };

  const handleDeselectAll = () => {
    setSelectedIds(new Set());
  };

  const handleBulkAdd = () => {
    setBulkResult(null);
    setError(null);
    const ids = [...selectedIds];
    startBulkTransition(async () => {
      const result = await bulkAddStoresFromPlacesAction(ids);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const { added, failed, failedPlaceIds } = result.data;
      if (added > 0) {
        // 1 件でも追加できたら登録店舗一覧へ遷移する (失敗分は toast で通知)。
        toast.success(
          failed > 0
            ? `${added}件を登録しました（${failed}件は失敗）`
            : `${added}件を登録しました`,
        );
        router.push("/stores");
        return;
      }
      // added === 0 (全件失敗): 留まって結果を表示し、再試行できるようにする。
      const failedSet = new Set(failedPlaceIds);
      const succeededIds = ids.filter((id) => !failedSet.has(id));
      setAddedIds((prev) => new Set([...prev, ...succeededIds]));
      setSelectedIds(new Set());
      setBulkResult({ added, failed });
    });
  };

  const showBar = selectedIds.size >= 1;
  // 上部「全選択」導線を出すか: 登録可能 (DB 未登録 かつ 未追加) な候補が残っている場合のみ。
  const eligibleCount = results.filter(
    ({ place, matchedStore }) =>
      matchedStore === null && !addedIds.has(place.placeId),
  ).length;

  return (
    <div className="space-y-4">
      {/* 0 件選択時のみ: 最初の一括選択への導線をリスト上部に残す (Option B)。
          下部バーは選択中のみ出るため、これが無いと最初に全選択する手段が消える。 */}
      {!showBar && eligibleCount > 0 && (
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleSelectAll}>
            全選択
          </Button>
          <span className="text-sm text-muted-foreground">
            登録したい店舗にチェックを入れてください
          </span>
        </div>
      )}

      {/* error / bulkResult はバー外 (上部) に常駐させる。
          全件失敗時は handleBulkAdd が selectedIds を空にしてバーが消えるため、
          バー内に置くと結果表示ごと消えてしまう。 */}
      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}
      {/* bulkResult は全件失敗 (added === 0) の分岐でしか set されないため、
          成功 0 件のときは「登録できませんでした」と失敗件数のみを示す。
          added > 0 の表示は将来の分岐追加に備えた防御的フォールバック。 */}
      {bulkResult && (
        <p
          className="text-sm text-destructive"
          role="status"
          aria-live="polite"
        >
          {bulkResult.added > 0
            ? `${bulkResult.added}件追加しました（${bulkResult.failed}件は失敗）`
            : `登録できませんでした（${bulkResult.failed}件失敗）`}
        </p>
      )}

      {/* バー表示中はリスト末尾に下部余白を足し、最後の数件が sticky バーの
          下に隠れてクリック/確認しづらくなるのを防ぐ。バー高さ + 余白の目安。 */}
      <div className={showBar ? "pb-20" : undefined}>
        <PlaceResultList
          results={results}
          addedIds={addedIds}
          selectedIds={selectedIds}
          onAdded={handleAdded}
          onToggle={handleToggle}
        />
      </div>

      {/* 下部固定バー: 1 件以上選択時のみ表示。
          sticky にすることでメインのコンテンツ幅に追従し、サイドバー折りたたみ (#106) でも
          左端がズレない。Topbar の sticky top-0 と同じ仕組みでビューポート基準に貼り付く。 */}
      {showBar && (
        <div
          role="region"
          aria-label="選択した店舗の一括操作"
          className="sticky bottom-0 z-30 flex flex-wrap items-center gap-2 border-t border-border bg-background/80 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md"
        >
          <Button variant="outline" size="sm" onClick={handleSelectAll}>
            全選択
          </Button>
          <Button variant="ghost" size="sm" onClick={handleDeselectAll}>
            選択を解除
          </Button>
          <span className="text-sm text-muted-foreground" aria-live="polite">
            {selectedIds.size}件選択中
          </span>
          <Button
            variant="primary"
            size="sm"
            onClick={handleBulkAdd}
            disabled={isBulkPending}
            className="ml-auto gap-1.5"
          >
            {isBulkPending ? (
              <>
                <Spinner className="text-primary-foreground" />
                登録中…
              </>
            ) : (
              "選択した店舗を登録"
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
