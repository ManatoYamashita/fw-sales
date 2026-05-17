/// <reference types="react/canary" />
"use client";

import {
  useCallback,
  useState,
  useTransition,
  ViewTransition,
} from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StoreNewForm } from "./store-new-form";
import {
  AreaSearchPanel,
  ManualStartPanel,
  UrlSearchPanel,
  type UrlLoadPayload,
} from "./registration-mode-card";
import { UrlImportSummary } from "./url-import-summary";
import { AreaSearchResults } from "./area-search-results";
import type { Profile } from "@/types/profile";
import type { PlaceWithMatch } from "@/lib/places/types";

export type RegistrationMode = "manual" | "url" | "area";

export interface StoreRegistrationTabsProps {
  /** SSR で `searchParams.mode` を正規化した初期モード */
  initialMode: RegistrationMode;
  /** GEMINI_API_KEY 設定済み boolean (URL/手動 タブの AI 分析パネルで使用) */
  isApiKeyConfigured: boolean;
  /** GOOGLE_PLACES_API_KEY 設定済み boolean (エリア検索タブで使用) */
  isPlacesApiConfigured: boolean;
  /** 担当者選択肢 (URL/手動 タブの単店舗フォームで使用) */
  profiles: readonly Profile[];
  /** 現在ログイン中の profile.id (デフォルト担当者として使用) */
  currentProfileId: string | null;
}

/**
 * `/stores/new` 配下で 手動 / URL貼付 / エリア検索 を切り替えるタブラッパー。
 *
 * 状態管理:
 * - タブ選択は `searchParams (?mode=)` と同期 (URL 共有・リロード復元・ブラウザバック対応)。
 * - 各モードの「検索/読込/開始」ボタン押下後に `stepUnlocked` が true になり、
 *   カード下にコンテンツ(フォーム or 検索結果)が表示される。
 * - タブ切替時は `stepUnlocked` をリセットして「ファーストビュー=カードのみ」に戻す。
 *
 * アニメーション:
 * - React の `<ViewTransition>` でカード内パネル切替・カード下展開を fade で繋ぐ。
 * - state 更新を `startTransition` で囲むことで View Transition がアクティブになる。
 * - 未サポートブラウザでは即時切替 (アニメ無し、機能影響なし)。
 */
export function StoreRegistrationTabs({
  initialMode,
  isApiKeyConfigured,
  isPlacesApiConfigured,
  profiles,
  currentProfileId,
}: StoreRegistrationTabsProps) {
  const [mode, setMode] = useState<RegistrationMode>(initialMode);
  const [stepUnlocked, setStepUnlocked] = useState(false);
  const [urlImport, setUrlImport] = useState<UrlLoadPayload | null>(null);
  const [areaResults, setAreaResults] = useState<
    readonly PlaceWithMatch[] | null
  >(null);
  const [, startTransition] = useTransition();
  const router = useRouter();

  const handleModeChange = useCallback(
    (next: string) => {
      const normalized: RegistrationMode =
        next === "manual" || next === "area" || next === "url" ? next : "url";
      if (normalized === mode) return;
      // 下部のリセットは startTransition の外で同期実行する。
      // transition 内に入れると下部 ViewTransition の exit fade-out が走り、
      // 前モードのコンテンツが一瞬残って「フラッシュ」して見える。
      setStepUnlocked(false);
      setUrlImport(null);
      setAreaResults(null);
      // mode 切替とルーター更新だけ View Transition の対象にする (上部パネルの fade)。
      startTransition(() => {
        setMode(normalized);
        router.replace(`/stores/new?mode=${normalized}`, { scroll: false });
      });
    },
    [mode, router],
  );

  const handleUrlLoaded = (payload: UrlLoadPayload) => {
    startTransition(() => {
      setUrlImport(payload);
      setStepUnlocked(true);
    });
  };

  const handleAreaSearched = (results: readonly PlaceWithMatch[]) => {
    if (results.length === 0) {
      // 0 件はエラー扱い(子パネルで alert 表示)。step は開かない。
      setAreaResults(results);
      return;
    }
    startTransition(() => {
      setAreaResults(results);
      setStepUnlocked(true);
    });
  };

  const handleManualStart = () => {
    startTransition(() => {
      setStepUnlocked(true);
    });
  };

  return (
    <div className="space-y-4">
      <Card>
        <Card.Body className="space-y-5">
          <Tabs
            value={mode}
            onValueChange={handleModeChange}
            defaultValue={initialMode}
            variant="pill"
          >
            <div className="flex justify-center">
              <TabsList>
                <TabsTrigger value="manual">手動</TabsTrigger>
                <TabsTrigger value="url">URL 貼付</TabsTrigger>
                <TabsTrigger value="area">エリア検索</TabsTrigger>
              </TabsList>
            </div>
          </Tabs>

          <ViewTransition default="none" enter="fade-in" exit="fade-out">
            {mode === "manual" && (
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
        </Card.Body>
      </Card>

      {stepUnlocked && (
        <ViewTransition default="none" enter="fade-in" exit="fade-out">
          <div className="space-y-4">
            {mode === "manual" && (
              <StoreNewForm
                isApiKeyConfigured={isApiKeyConfigured}
                profiles={profiles}
                currentProfileId={currentProfileId}
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
                  isApiKeyConfigured={isApiKeyConfigured}
                  profiles={profiles}
                  currentProfileId={currentProfileId}
                  initialImport={{
                    suggested: urlImport.suggested,
                    html: urlImport.html,
                  }}
                />
              </>
            )}
            {mode === "area" && areaResults && (
              <AreaSearchResults results={areaResults} />
            )}
          </div>
        </ViewTransition>
      )}
    </div>
  );
}
