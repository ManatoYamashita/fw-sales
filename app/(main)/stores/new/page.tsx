import type { Metadata } from "next";
import { StoreRegistrationTabs } from "./_components/store-registration-tabs";
import { isPlacesApiKeyConfigured } from "@/lib/env";
import { getAllProfiles } from "@/lib/queries/profiles";
import { getCurrentProfile } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "店舗登録",
};

type SearchParams = Promise<{ mode?: string | string[] }>;

function normalizeMode(
  raw: string | string[] | undefined,
): "manual" | "url" | "area" {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v === "manual" || v === "area") return v;
  return "url";
}

export default async function NewStorePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  // GOOGLE_PLACES_API_KEY の有無を SSR で判定し、Client へ boolean のみで渡す。
  // (旧 GEMINI_API_KEY 用 isApiKeyConfigured / プロンプトテンプレート取得は task 4.2 / PR3a で
  // AiAnalysisPanel 撤去に伴い不要になった。営業資産生成は店舗詳細の SalesAssetsGenerator に統一。)
  const placesApiConfigured = isPlacesApiKeyConfigured();
  // 担当者選択肢 + 現在ログイン中ユーザを SSR で取得し props 経由で渡す (Phase 7.3)。
  const [profiles, currentProfile, sp] = await Promise.all([
    getAllProfiles({ excludePlaceholders: false }),
    getCurrentProfile(),
    searchParams,
  ]);
  const initialMode = normalizeMode(sp.mode);

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <div>
        <h2 className="text-xl md:text-2xl font-bold text-foreground">
          店舗を登録
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          URL 貼付またはエリア検索で店舗を登録できます。タブで方法を切り替えてください。
        </p>
      </div>
      <StoreRegistrationTabs
        initialMode={initialMode}
        isPlacesApiConfigured={placesApiConfigured}
        profiles={profiles}
        currentProfileId={currentProfile?.id ?? null}
      />
    </div>
  );
}
