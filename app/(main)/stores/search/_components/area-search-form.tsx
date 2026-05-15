"use client";

import { useState, useTransition } from "react";
import { Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Spinner } from "@/components/ui/spinner";
import { PlaceResultList } from "./place-result-list";
import { searchPlacesAction } from "@/lib/actions/area-search-actions";
import type { PlaceResult } from "@/lib/places/types";

export function AreaSearchForm() {
  const [keyword, setKeyword] = useState("");
  const [area, setArea] = useState("");
  const [results, setResults] = useState<PlaceResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addedIds, setAddedIds] = useState<ReadonlySet<string>>(new Set());
  const [isPending, startTransition] = useTransition();

  const handleSearch = () => {
    setError(null);
    startTransition(async () => {
      const result = await searchPlacesAction(keyword, area);
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
  };

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

      {results !== null && results.length > 0 && (
        <PlaceResultList
          results={results}
          addedIds={addedIds}
          onAdded={handleAdded}
        />
      )}
    </div>
  );
}
