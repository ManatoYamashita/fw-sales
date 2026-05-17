"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Tabs, TabsList, TabsTrigger, TabsPanel } from "@/components/ui/tabs";
import { StoreNewForm } from "./store-new-form";
import { AreaSearchForm } from "./area-search-form";
import type { Profile } from "@/types/profile";

export type RegistrationMode = "url" | "area";

export interface StoreRegistrationTabsProps {
  /** SSR で `searchParams.mode` を正規化した初期モード */
  initialMode: RegistrationMode;
  /** GEMINI_API_KEY 設定済み boolean (URLタブの AI 分析パネルで使用) */
  isApiKeyConfigured: boolean;
  /** GOOGLE_PLACES_API_KEY 設定済み boolean (エリア検索タブで使用) */
  isPlacesApiConfigured: boolean;
  /** 担当者選択肢 (URLタブの単店舗フォームで使用) */
  profiles: readonly Profile[];
  /** 現在ログイン中の profile.id (デフォルト担当者として使用) */
  currentProfileId: string | null;
}

/**
 * `/stores/new` 配下で URL貼付 / エリア検索 を切り替えるタブラッパー。
 *
 * 状態同期:
 * - ローカル `useState` をソースオブトゥルースとして即時 UI 反映。
 * - 切替時に `useRouter().replace('?mode=...', { scroll: false })` で URL を更新し、
 *   URL 共有・リロード復元・ブラウザバックを成立させる。
 * - `initialMode` は RSC 側で `searchParams` から正規化済みのため、不正値防御は呼び出し元で完結。
 */
export function StoreRegistrationTabs({
  initialMode,
  isApiKeyConfigured,
  isPlacesApiConfigured,
  profiles,
  currentProfileId,
}: StoreRegistrationTabsProps) {
  const [mode, setMode] = useState<RegistrationMode>(initialMode);
  const [, startTransition] = useTransition();
  const router = useRouter();

  const handleChange = useCallback(
    (next: string) => {
      const normalized: RegistrationMode = next === "area" ? "area" : "url";
      if (normalized === mode) return;
      setMode(normalized);
      startTransition(() => {
        router.replace(`/stores/new?mode=${normalized}`, { scroll: false });
      });
    },
    [mode, router],
  );

  return (
    <Tabs
      value={mode}
      onValueChange={handleChange}
      defaultValue={initialMode}
      variant="pill"
    >
      <div className="flex justify-center">
        <TabsList>
          <TabsTrigger value="url">URL 貼付</TabsTrigger>
          <TabsTrigger value="area">エリア検索</TabsTrigger>
        </TabsList>
      </div>
      <TabsPanel value="url">
        <StoreNewForm
          isApiKeyConfigured={isApiKeyConfigured}
          profiles={profiles}
          currentProfileId={currentProfileId}
        />
      </TabsPanel>
      <TabsPanel value="area">
        <AreaSearchForm isPlacesApiConfigured={isPlacesApiConfigured} />
      </TabsPanel>
    </Tabs>
  );
}
