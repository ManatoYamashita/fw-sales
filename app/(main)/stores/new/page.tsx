import type { Metadata } from "next";
import { StoreNewForm } from "./_components/store-new-form";
import { isApiKeyConfigured } from "@/lib/env";

export const metadata: Metadata = {
  title: "店舗登録",
};

export default function NewStorePage() {
  // GEMINI_API_KEY の有無を SSR で判定し、Client Component に boolean で渡す。
  // 値そのものは渡さず、AI 分析ボタンの disabled 制御にのみ使う(Req 2.7)。
  const apiKeyConfigured = isApiKeyConfigured();

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <div>
        <h2 className="text-xl md:text-2xl font-bold text-foreground">
          店舗を登録
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          食べログ・GoogleマップのURLから自動入力できます。
          必須項目は店舗名のみです。
        </p>
      </div>
      <StoreNewForm isApiKeyConfigured={apiKeyConfigured} />
    </div>
  );
}
