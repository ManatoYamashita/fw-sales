/// <reference types="react/canary" />
"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useTransition,
  ViewTransition,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils/cn";
import { StoreNewForm } from "./store-new-form";
import {
  AreaSearchPanel,
  ManualStartPanel,
  UrlSearchPanel,
  type AreaSearchSessionResult,
  type UrlLoadPayload,
} from "./registration-mode-card";
import { UrlImportSummary } from "./url-import-summary";
import { AreaSearchResults } from "./area-search-results";
import type { Profile } from "@/types/profile";

export type RegistrationMode = "manual" | "url" | "area";

export interface StoreRegistrationTabsProps {
  /** SSR で `searchParams.mode` を正規化した初期モード */
  initialMode: RegistrationMode;
  /** GOOGLE_PLACES_API_KEY 設定済み boolean (エリア検索タブで使用) */
  isPlacesApiConfigured: boolean;
  /** 担当者選択肢 (URL/手動 タブの単店舗フォームで使用) */
  profiles: readonly Profile[];
  /** 現在ログイン中の profile.id (デフォルト担当者として使用) */
  currentProfileId: string | null;
}

function normalizeMode(raw: string | null | undefined): RegistrationMode {
  return raw === "manual" || raw === "url" ? raw : "area";
}

/**
 * `/stores/new` 配下で 手動 / URL貼付 / エリア検索 を切り替えるタブラッパー。
 *
 * 状態管理:
 * - タブ選択は `searchParams (?mode=)` を **唯一のソースオブトゥルース** として導出する。
 *   ローカル useState を持たないため、Topbar や Sidebar からの同一ルート再ナビゲーション
 *   (例: `/stores/new?mode=area` → `/stores/new`) でも UI が必ず URL に追従する。
 * - 切替時は `router.push` で履歴に積み、ブラウザ戻る/進むでタブ復元できるようにする。
 * - 各モードの「検索/読込/開始」ボタン押下後に `stepUnlocked` が true になり、
 *   カード下にコンテンツ(フォーム or 検索結果)が表示される。
 * - mode が切替わると `stepUnlocked` / 下部表示用 state を **意図的にリセット** する。
 *   3 モードはそれぞれ別の「起点」であり、前モードの入力中フォームや検索結果を残すと
 *   UX が混乱するため、タブ=リセット仕様としている。
 *
 * アニメーション:
 * - React の `<ViewTransition>` でカード内パネル切替・カード下展開を fade で繋ぐ。
 * - state 更新を `startTransition` で囲むことで View Transition がアクティブになる。
 * - 未サポートブラウザでは即時切替 (アニメ無し、機能影響なし)。
 */
export function StoreRegistrationTabs({
  initialMode,
  isPlacesApiConfigured,
  profiles,
  currentProfileId,
}: StoreRegistrationTabsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  // mode は URL から derive (Copilot レビュー対応: state を URL に従属させる)。
  // initialMode は SSR 初回レンダリング時の fallback として使用。
  const mode: RegistrationMode = useMemo(() => {
    const raw = searchParams.get("mode");
    return raw !== null ? normalizeMode(raw) : initialMode;
  }, [searchParams, initialMode]);

  // 楽観的モード: クリック直後にタブのハイライトを即時更新するための値。
  // router.push の RSC 往復が完了するまで startTransition が pending を維持し、
  // 完了後は mode (URL 由来) に自動で戻る。「固まる」体感を解消する。
  const [optimisticMode, setOptimisticMode] = useOptimistic(mode);

  const [stepUnlocked, setStepUnlocked] = useState(false);
  const [urlImport, setUrlImport] = useState<UrlLoadPayload | null>(null);
  const [areaResults, setAreaResults] = useState<AreaSearchSessionResult | null>(
    null,
  );
  // 検索1回ごとにインクリメントし、AreaSearchResults の key として使う。
  // 再検索のたびに新しいコンポーネントとしてマウントし直すことで、選択状態・
  // 追加ページ読込状態 (allResults/nextPageToken 等) を確実にリセットする。
  const [areaSearchSeq, setAreaSearchSeq] = useState(0);
  const [manualStoreName, setManualStoreName] = useState("");

  // mode 変化 (URL 変化) を検知して下部 state をリセットする。
  // ブラウザ戻る/進むや別画面からの再進入でも同じ「ファーストビュー」に戻すため、
  // handleModeChange ではなくここで一元化する。
  const previousModeRef = useRef(mode);
  useEffect(() => {
    if (previousModeRef.current !== mode) {
      setStepUnlocked(false);
      setUrlImport(null);
      setAreaResults(null);
      setManualStoreName("");
      previousModeRef.current = mode;
    }
  }, [mode]);

  const handleModeChange = useCallback(
    (next: string) => {
      const normalized = normalizeMode(next);
      if (normalized === mode) return;
      // push でブラウザバック対応 (?mode の遷移を履歴に残す)。
      // ルーター更新だけ View Transition の対象にする (上部パネルの fade)。
      // 下部 state リセットは上記 useEffect で URL 変化に追従する形で実行。
      startTransition(() => {
        // クリックしたタブを即時ハイライト (RSC 往復を待たない)。
        setOptimisticMode(normalized);
        router.push(`/stores/new?mode=${normalized}`, { scroll: false });
      });
    },
    [mode, router, setOptimisticMode],
  );

  const handleUrlLoaded = (payload: UrlLoadPayload) => {
    startTransition(() => {
      setUrlImport(payload);
      setStepUnlocked(true);
    });
  };

  const handleAreaSearched = (result: AreaSearchSessionResult) => {
    if (result.places.length === 0) {
      // 0 件はエラー扱い(子パネルで alert 表示)。step は開かない。
      setAreaResults(result);
      return;
    }
    startTransition(() => {
      setAreaResults(result);
      setAreaSearchSeq((seq) => seq + 1);
      setStepUnlocked(true);
    });
  };

  const handleManualStart = (name: string) => {
    startTransition(() => {
      setManualStoreName(name);
      setStepUnlocked(true);
    });
  };

  return (
    <div className="space-y-4">
      <Card>
        <Card.Body className="space-y-5">
          <Tabs
            value={optimisticMode}
            onValueChange={handleModeChange}
            defaultValue={initialMode}
            variant="pill"
          >
            <div className="relative flex justify-center">
              <TabsList>
                <TabsTrigger value="manual">手動</TabsTrigger>
                <TabsTrigger value="area">エリア検索</TabsTrigger>
                <TabsTrigger value="url">URL 貼付</TabsTrigger>
              </TabsList>
              {isPending && (
                <Spinner
                  className="absolute right-0 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                />
              )}
            </div>
          </Tabs>

          <div
            className={cn(
              "transition-opacity",
              isPending && "pointer-events-none opacity-60",
            )}
            aria-busy={isPending}
          >
          <ViewTransition default="none" enter="fade-in" exit="fade-out">
            {/* 手動モードでフォーム展開後は ManualStartPanel を隠す。
                StoreNewForm の `initialName` は `useState` 初期値にしか使われないため、
                上部入力欄を変更しても下部フォームの店舗名と sync しない問題を
                「上部 UI を消す」ことで物理的に防ぐ。店舗名を変えたい場合は
                フォーム内の「店舗名」フィールドで直接編集する。やり直したい場合は
                タブを再選択することで mode 変化検知でリセットされる。 */}
            {mode === "manual" && !stepUnlocked && (
              <ManualStartPanel onStart={handleManualStart} />
            )}
            {mode === "url" && <UrlSearchPanel onLoaded={handleUrlLoaded} />}
            {mode === "area" && (
              <AreaSearchPanel
                onSearched={handleAreaSearched}
                isPlacesApiConfigured={isPlacesApiConfigured}
              />
            )}
          </ViewTransition>
          </div>
        </Card.Body>
      </Card>

      {stepUnlocked && (
        <ViewTransition default="none" enter="fade-in" exit="fade-out">
          <div
            className={cn(
              "space-y-4 transition-opacity",
              isPending && "pointer-events-none opacity-60",
            )}
            aria-busy={isPending}
          >
            {mode === "manual" && (
              <StoreNewForm
                key={manualStoreName}
                profiles={profiles}
                currentProfileId={currentProfileId}
                initialName={manualStoreName}
              />
            )}
            {mode === "url" && urlImport && (
              <>
                <UrlImportSummary
                  sourceType={urlImport.sourceType}
                  applied={urlImport.applied}
                  chained={urlImport.chained}
                  ogpError={urlImport.ogpError}
                  storeName={urlImport.suggested.name}
                />
                <StoreNewForm
                  profiles={profiles}
                  currentProfileId={currentProfileId}
                  initialImport={{
                    suggested: urlImport.suggested,
                    html: urlImport.html,
                  }}
                />
              </>
            )}
            {mode === "area" && areaResults && areaResults.places.length > 0 && (
              <AreaSearchResults
                key={areaSearchSeq}
                results={areaResults.places}
                nextPageToken={areaResults.nextPageToken}
                keyword={areaResults.keyword}
                area={areaResults.area}
                center={areaResults.center}
                radiusMeters={areaResults.radiusMeters}
                meta={areaResults.meta}
              />
            )}
          </div>
        </ViewTransition>
      )}
    </div>
  );
}
