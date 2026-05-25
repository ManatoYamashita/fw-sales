import type { Metadata } from "next";
import { StoreRegistrationTabs } from "./_components/store-registration-tabs";
import { isApiKeyConfigured, isPlacesApiKeyConfigured } from "@/lib/env";
import { getAllProfiles } from "@/lib/queries/profiles";
import { getCurrentProfile } from "@/lib/supabase/server";
import { listPromptTemplatesCached } from "@/lib/queries/prompt-templates";
import type { PromptTemplateOption } from "./_components/ai-analysis-panel";

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
  // GEMINI_API_KEY / GOOGLE_PLACES_API_KEY の有無を SSR で判定し、Client へ boolean のみで渡す。
  // 値そのものは渡さず、AI 分析ボタン / エリア検索ボタンの disabled 制御にのみ使う。
  const apiKeyConfigured = isApiKeyConfigured();
  const placesApiConfigured = isPlacesApiKeyConfigured();
  // 担当者選択肢 + 現在ログイン中ユーザを SSR で取得し props 経由で渡す (Phase 7.3)。
  const [profiles, currentProfile, sp] = await Promise.all([
    getAllProfiles({ excludePlaceholders: false }),
    getCurrentProfile(),
    searchParams,
  ]);
  const initialMode = normalizeMode(sp.mode);
  // プロンプトテンプレート一覧: id/name/is_default のみに絞ってクライアントへ渡す (Issue #42 Phase 4-D)
  const promptTemplates: PromptTemplateOption[] = currentProfile
    ? (await listPromptTemplatesCached(currentProfile.id)).map(
        ({ id, name, is_default }) => ({ id, name, is_default }),
      )
    : [];

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
        isApiKeyConfigured={apiKeyConfigured}
        isPlacesApiConfigured={placesApiConfigured}
        profiles={profiles}
        currentProfileId={currentProfile?.id ?? null}
        promptTemplates={promptTemplates}
      />
    </div>
  );
}
