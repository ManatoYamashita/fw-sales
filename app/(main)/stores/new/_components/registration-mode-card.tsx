"use client";

import { useState, useTransition, type KeyboardEvent } from "react";
import { Download, Pencil, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { importFromUrlAction } from "@/lib/actions/url-parse-actions";
import { Select } from "@/components/ui/select";
import { searchPlacesWithMatchesAction } from "@/lib/actions/area-search-actions";
import type {
  AppliedField,
  ApplyResult,
  ParsedSource,
} from "@/lib/url-parser/types";
import type { AreaSearchPlaceViewModel, SearchCenter } from "@/lib/places/types";
import {
  ManualFallbackModal,
  type ManualFallbackReason,
} from "./manual-fallback-modal";

/**
 * Places フォールバックが「補完できなかった」状態かどうか判定する。
 * none / no_api_key は失敗ではなく不発として扱い (モーダルは出さない)、
 * places_not_found / no_keyword / api_error は手入力モーダル誘導の対象。
 */
function placesFallbackFailed(reason: string | undefined): boolean {
  return (
    reason === "places_not_found" ||
    reason === "no_keyword" ||
    reason === "api_error"
  );
}

/** Partial<ApplyResult> を完全な ApplyResult に補完する (モーダル確定値を親へ渡すため) */
function ensureFullApplyResult(partial: Partial<ApplyResult>): ApplyResult {
  return {
    name: partial.name ?? "",
    prefecture: partial.prefecture ?? "",
    city: partial.city ?? "",
    phone: partial.phone ?? "",
    site_url: partial.site_url ?? "",
    map_url: partial.map_url ?? "",
    instagram_url: partial.instagram_url ?? "",
    genre: partial.genre ?? "",
    address: partial.address ?? "",
    review_avg: partial.review_avg ?? null,
    review_count: partial.review_count ?? null,
    memo: partial.memo ?? "",
    operator_type: partial.operator_type ?? "未設定",
    operator_name: partial.operator_name ?? "",
    confidence: partial.confidence ?? {},
  };
}

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
  const [modalState, setModalState] = useState<
    | { open: false }
    | {
        open: true;
        reason: ManualFallbackReason;
        partial?: Partial<ApplyResult>;
      }
  >({ open: false });

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

        // URL パース完全失敗 → モーダル誘導 (取得済データ無し)
        if (!result.parsed) {
          setModalState({ open: true, reason: "parse_failed" });
          return;
        }

        const html =
          result.ogp && result.ogp.ok ? (result.ogp.html ?? null) : null;
        const hits = result.applied.filter(
          (f) => f.value !== "" && typeof f.confidence === "number",
        );
        const summary = `${result.applied.length} 項目中 ${hits.length} 項目を取得`;

        // Places フォールバックの結果に応じた toast 出し分け
        if (result.placesFallback?.used) {
          toast.info(
            `Google Maps から不足項目を補完しました${
              result.suggested.name ? ` (${result.suggested.name})` : ""
            }`,
          );
        } else if (placesFallbackFailed(result.placesFallback?.reason)) {
          // 取得済データを引き継いだままモーダル誘導 (places_not_found 等)
          toast.warn(
            "Google Maps で店舗を特定できませんでした。手入力で補ってください",
          );
          setModalState({
            open: true,
            reason: "places_not_found",
            partial: result.suggested,
          });
          return;
        } else {
          toast.success(
            result.suggested.name
              ? `「${result.suggested.name}」: ${summary}`
              : summary,
          );
        }

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

  const handleFallbackConfirm = (partial: Partial<ApplyResult>) => {
    const suggested = ensureFullApplyResult(partial);
    // モーダル経由の確定は OGP / Places のソースが特定できないので unknown 扱い
    onLoaded({
      suggested,
      html: null,
      applied: [],
      sourceType: "unknown",
      chained: false,
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
      <ManualFallbackModal
        open={modalState.open}
        onOpenChange={(next) => {
          if (!next) setModalState({ open: false });
        }}
        reason={modalState.open ? modalState.reason : "parse_failed"}
        partial={modalState.open ? modalState.partial : undefined}
        onConfirm={handleFallbackConfirm}
      />
    </div>
  );
}

// ---- Area -----------------------------------------------------------------

/** 半径選択肢 (メートル)。初期値は1km。 */
const RADIUS_OPTIONS = [
  { value: 500, label: "500m" },
  { value: 1000, label: "1km" },
  { value: 2000, label: "2km" },
  { value: 3000, label: "3km" },
] as const;

const DEFAULT_RADIUS_METERS = 1000;

/** エリア検索1回分の結果。「もっと読み込む」で再検索する際に keyword/area/center/radius を引き継ぐ。 */
export interface AreaSearchSessionResult {
  places: readonly AreaSearchPlaceViewModel[];
  nextPageToken: string | null;
  keyword: string;
  /** 中心地点入力値 (駅名・住所など)。互換のためプロパティ名は `area` のまま。 */
  area: string;
  /** `area` を解決した緯度経度。 */
  center: SearchCenter;
  /** 検索半径 (メートル)。 */
  radiusMeters: number;
}

export interface AreaSearchPanelProps {
  onSearched: (result: AreaSearchSessionResult) => void;
  isPlacesApiConfigured: boolean;
}

export function AreaSearchPanel({
  onSearched,
  isPlacesApiConfigured,
}: AreaSearchPanelProps) {
  const [keyword, setKeyword] = useState("");
  const [area, setArea] = useState("");
  const [radiusMeters, setRadiusMeters] = useState<number>(DEFAULT_RADIUS_METERS);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleSearch = () => {
    if (!isPlacesApiConfigured) return;
    setError(null);
    startTransition(async () => {
      const result = await searchPlacesWithMatchesAction(
        keyword,
        area,
        radiusMeters,
      );
      if (result.ok) {
        const { places, nextPageToken, center } = result.data;
        if (places.length === 0) {
          setError(
            "該当する店舗が見つかりませんでした。条件を変えて再検索してください。",
          );
        }
        onSearched({ places, nextPageToken, keyword, area, center, radiusMeters });
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
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
            placeholder="例: 居酒屋、カフェ、焼肉、ラーメン"
            disabled={!isPlacesApiConfigured}
          />
        </FormField>
        <FormField
          label="中心地点"
          htmlFor="area"
          hint="駅名・住所など(必須)"
        >
          <Input
            id="area"
            type="text"
            value={area}
            onChange={(e) => setArea(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="例: 渋谷駅、新宿駅、赤坂見附駅"
            disabled={!isPlacesApiConfigured}
          />
        </FormField>
        <FormField label="半径" htmlFor="radius" hint="中心地点からの目安距離">
          <Select
            id="radius"
            value={radiusMeters}
            onChange={(e) => setRadiusMeters(Number(e.target.value))}
            disabled={!isPlacesApiConfigured}
          >
            {RADIUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
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
