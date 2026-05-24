/// <reference types="react/canary" />
"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  ViewTransition,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StoreNewForm } from "./store-new-form";
import type { PromptTemplateOption } from "./ai-analysis-panel";
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
  /** SSR で取得したプロンプトテンプレート一覧(Issue #42 Phase 4-D) */
  promptTemplates: readonly PromptTemplateOption[];
}

function normalizeMode(raw: string | null | undefined): RegistrationMode {
  return raw === "manual" || raw === "area" ? raw : "url";
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
  isApiKeyConfigured,
  isPlacesApiConfigured,
  profiles,
  currentProfileId,
  promptTemplates,
}: StoreRegistrationTabsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  // mode は URL から derive (Copilot レビュー対応: state を URL に従属させる)。
  // initialMode は SSR 初回レンダリング時の fallback として使用。
  const mode: RegistrationMode = useMemo(() => {
    const raw = searchParams.get("mode");
    return raw !== null ? normalizeMode(raw) : initialMode;
  }, [searchParams, initialMode]);

  const [stepUnlocked, setStepUnlocked] = useState(false);
  const [urlImport, setUrlImport] = useState<UrlLoadPayload | null>(null);
  const [areaResults, setAreaResults] = useState<
    readonly PlaceWithMatch[] | null
  >(null);
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
        router.push(`/stores/new?mode=${normalized}`, { scroll: false });
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
                key={manualStoreName}
                isApiKeyConfigured={isApiKeyConfigured}
                profiles={profiles}
                currentProfileId={currentProfileId}
                initialName={manualStoreName}
                promptTemplates={promptTemplates}
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
                  promptTemplates={promptTemplates}
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
