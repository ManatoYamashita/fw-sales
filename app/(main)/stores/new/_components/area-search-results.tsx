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

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Button variant="outline" size="sm" onClick={handleSelectAll}>
          全選択
        </Button>
        <Button variant="ghost" size="sm" onClick={handleDeselectAll}>
          選択解除
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={handleBulkAdd}
          disabled={selectedIds.size === 0 || isBulkPending}
          className="gap-1.5"
        >
          {isBulkPending ? (
            <>
              <Spinner className="text-primary-foreground" />
              追加中…
            </>
          ) : selectedIds.size > 0 ? (
            `選択して追加 (${selectedIds.size})`
          ) : (
            "選択して追加"
          )}
        </Button>
        {bulkResult && (
          <span className="text-sm text-muted-foreground">
            {bulkResult.added}件追加しました
            {bulkResult.failed > 0 && (
              <span className="text-destructive">
                {" "}
                / {bulkResult.failed}件失敗しました
              </span>
            )}
          </span>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      <PlaceResultList
        results={results}
        addedIds={addedIds}
        selectedIds={selectedIds}
        onAdded={handleAdded}
        onToggle={handleToggle}
      />
    </div>
  );
}
