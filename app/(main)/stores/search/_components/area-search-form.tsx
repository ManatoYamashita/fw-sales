"use client";

import { useState, useTransition } from "react";
import { Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Spinner } from "@/components/ui/spinner";
import { PlaceResultList } from "./place-result-list";
import {
  searchPlacesWithMatchesAction,
  bulkAddStoresFromPlacesAction,
} from "@/lib/actions/area-search-actions";
import type { PlaceWithMatch } from "@/lib/places/types";

export function AreaSearchForm() {
  const [keyword, setKeyword] = useState("");
  const [area, setArea] = useState("");
  const [results, setResults] = useState<PlaceWithMatch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addedIds, setAddedIds] = useState<ReadonlySet<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [bulkResult, setBulkResult] = useState<{
    added: number;
    failed: number;
  } | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isBulkPending, startBulkTransition] = useTransition();

  const handleSearch = () => {
    setError(null);
    setSelectedIds(new Set());
    setBulkResult(null);
    startTransition(async () => {
      const result = await searchPlacesWithMatchesAction(keyword, area);
      if (result.ok) {
        setResults(result.data);
        if (result.data.length === 0) {
          setError("該当する店舗が見つかりませんでした。条件を変えて再検索してください。");
        }
      } else {
        setError(result.error);
        setResults(null);
      }
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) handleSearch();
  };

  const handleAdded = (placeId: string) => {
    setAddedIds((prev) => new Set([...prev, placeId]));
    // 個別追加されたら選択状態も解除
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
    const eligible = (results ?? [])
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
    const ids = [...selectedIds];
    startBulkTransition(async () => {
      const result = await bulkAddStoresFromPlacesAction(ids);
      if (result.ok) {
        const { added, failed, failedPlaceIds } = result.data;
        const failedSet = new Set(failedPlaceIds);
        const succeededIds = ids.filter((id) => !failedSet.has(id));
        setAddedIds((prev) => new Set([...prev, ...succeededIds]));
        setSelectedIds(new Set());
        setBulkResult({ added, failed });
      } else {
        setError(result.error);
      }
    });
  };

  const hasResults = results !== null && results.length > 0;

  return (
    <div className="space-y-4">
      <Card>
        <Card.Header>
          <Card.Title>検索条件</Card.Title>
        </Card.Header>
        <Card.Body className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            label="キーワード"
            htmlFor="keyword"
            hint="業態・店舗名など（必須）"
          >
            <Input
              id="keyword"
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="例: 居酒屋、ラーメン、焼肉"
            />
          </FormField>
          <FormField
            label="エリア"
            htmlFor="area"
            hint="都市名・駅名など"
          >
            <Input
              id="area"
              type="text"
              value={area}
              onChange={(e) => setArea(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="例: 渋谷、横浜駅周辺"
            />
          </FormField>
        </Card.Body>
        <div className="flex justify-end px-5 pb-5">
          <Button
            variant="primary"
            onClick={handleSearch}
            disabled={isPending}
            className="gap-2"
          >
            {isPending ? (
              <>
                <Spinner className="text-primary-foreground" />
                検索中…
              </>
            ) : (
              <>
                <Search className="h-4 w-4" />
                検索する
              </>
            )}
          </Button>
        </div>
      </Card>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      {hasResults && (
        <>
          {/* 一括操作コントロール */}
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
                    {" "}/ {bulkResult.failed}件失敗しました
                  </span>
                )}
              </span>
            )}
          </div>

          <PlaceResultList
            results={results}
            addedIds={addedIds}
            selectedIds={selectedIds}
            onAdded={handleAdded}
            onToggle={handleToggle}
          />
        </>
      )}
    </div>
  );
}
