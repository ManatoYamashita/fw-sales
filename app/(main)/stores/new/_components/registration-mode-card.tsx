"use client";

import { useState, useTransition, type KeyboardEvent } from "react";
import { Download, Pencil, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { importFromUrlAction } from "@/lib/actions/url-parse-actions";
import { searchPlacesWithMatchesAction } from "@/lib/actions/area-search-actions";
import type {
  AppliedField,
  ApplyResult,
  ParsedSource,
} from "@/lib/url-parser/types";
import type { PlaceWithMatch } from "@/lib/places/types";

/** URL モードの読込結果(親に渡す payload) */
export interface UrlLoadPayload {
  suggested: ApplyResult;
  html: string | null;
  applied: readonly AppliedField[];
  sourceType: ParsedSource;
  chained: boolean;
  ogpError?: string;
}

// ---- Manual ----------------------------------------------------------------

export interface ManualStartPanelProps {
  onStart: (name: string) => void;
}

export function ManualStartPanel({ onStart }: ManualStartPanelProps) {
  const [storeName, setStoreName] = useState("");

  const submit = () => {
    const v = storeName.trim();
    if (!v) return;
    onStart(v);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const canSubmit = storeName.trim().length > 0;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        食べログ・Googleマップ URL もエリア検索も使わず、フォームに直接入力します。
        まず店舗名を入力し、Enter または「フォームを開く」で他の項目を入力できます。
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        <Input
          value={storeName}
          onChange={(e) => setStoreName(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="店舗名を入力"
          className="flex-1"
          aria-label="店舗名"
        />
        <Button
          variant="primary"
          onClick={submit}
          disabled={!canSubmit}
          className="sm:w-40 gap-2"
        >
          <Pencil className="h-4 w-4" />
          フォームを開く
        </Button>
      </div>
    </div>
  );
}

// ---- URL ------------------------------------------------------------------

export interface UrlSearchPanelProps {
  onLoaded: (payload: UrlLoadPayload) => void;
}

export function UrlSearchPanel({ onLoaded }: UrlSearchPanelProps) {
  const [url, setUrl] = useState("");
  const [pending, startTransition] = useTransition();

  const importNow = () => {
    if (!url.trim()) {
      toast.warn("URL を入力してください");
      return;
    }
    startTransition(async () => {
      try {
        const result = await importFromUrlAction(url, {
          fetchOgp: true,
          recursive: true,
        });
        if (!result.parsed) {
          toast.error("認識できる形式の URL ではありません");
          return;
        }
        const html =
          result.ogp && result.ogp.ok ? (result.ogp.html ?? null) : null;
        const hits = result.applied.filter(
          (f) => f.value !== "" && typeof f.confidence === "number",
        );
        const summary = `${result.applied.length} 項目中 ${hits.length} 項目を取得`;
        toast.success(
          result.suggested.name
            ? `「${result.suggested.name}」: ${summary}`
            : summary,
        );
        onLoaded({
          suggested: result.suggested,
          html,
          applied: result.applied,
          sourceType: result.parsed.type,
          chained: result.chained,
          ogpError:
            result.ogp?.ok === false ? result.ogp.error : undefined,
        });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "URL の取得に失敗しました");
      }
    });
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      importNow();
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        食べログ・Googleマップの店舗 URL を貼り付けて「読込」を押すと、
        都道府県・市区・店名・住所・口コミ件数などが自動入力されます。
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="https://tabelog.com/... または https://maps.google.com/..."
          className="flex-1"
          aria-label="店舗URL"
        />
        <Button
          variant="primary"
          onClick={importNow}
          disabled={pending}
          className="sm:w-32 gap-2"
        >
          {pending ? (
            <>
              <Spinner className="text-primary-foreground" />
              読込中…
            </>
          ) : (
            <>
              <Download className="h-4 w-4" />
              読込
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

// ---- Area -----------------------------------------------------------------

export interface AreaSearchPanelProps {
  onSearched: (results: readonly PlaceWithMatch[]) => void;
  isPlacesApiConfigured: boolean;
}

export function AreaSearchPanel({
  onSearched,
  isPlacesApiConfigured,
}: AreaSearchPanelProps) {
  const [keyword, setKeyword] = useState("");
  const [area, setArea] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleSearch = () => {
    if (!isPlacesApiConfigured) return;
    setError(null);
    startTransition(async () => {
      const result = await searchPlacesWithMatchesAction(keyword, area);
      if (result.ok) {
        if (result.data.length === 0) {
          setError(
            "該当する店舗が見つかりませんでした。条件を変えて再検索してください。",
          );
          onSearched([]);
        } else {
          onSearched(result.data);
        }
      } else {
        setError(result.error);
      }
    });
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (
      e.key === "Enter" &&
      !e.nativeEvent.isComposing &&
      isPlacesApiConfigured
    ) {
      e.preventDefault();
      handleSearch();
    }
  };

  return (
    <div className="space-y-3">
      {!isPlacesApiConfigured && (
        <div
          role="alert"
          className="rounded-md border border-border bg-muted/50 px-4 py-3 text-sm space-y-1"
        >
          <p className="font-medium text-foreground">
            Google Places APIキーが未設定です
          </p>
          <p className="text-muted-foreground">
            エリア検索を利用するには{" "}
            <code className="font-mono text-xs bg-background rounded border border-border px-1 py-0.5">
              .env.local
            </code>{" "}
            に{" "}
            <code className="font-mono text-xs bg-background rounded border border-border px-1 py-0.5">
              GOOGLE_PLACES_API_KEY
            </code>{" "}
            を設定してください。
          </p>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField
          label="キーワード"
          htmlFor="keyword"
          hint="業態・店舗名など(必須)"
        >
          <Input
            id="keyword"
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="例: 居酒屋、ラーメン、焼肉"
            disabled={!isPlacesApiConfigured}
          />
        </FormField>
        <FormField label="エリア" htmlFor="area" hint="都市名・駅名など">
          <Input
            id="area"
            type="text"
            value={area}
            onChange={(e) => setArea(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="例: 渋谷、横浜駅周辺"
            disabled={!isPlacesApiConfigured}
          />
        </FormField>
      </div>
      <div className="flex justify-end">
        <Button
          variant="primary"
          onClick={handleSearch}
          disabled={pending || !isPlacesApiConfigured}
          className="gap-2"
        >
          {pending ? (
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
      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}
    </div>
  );
}
