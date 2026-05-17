import type { Metadata } from "next";
import { isPlacesApiKeyConfigured } from "@/lib/env";
import { AreaSearchForm } from "../new/_components/area-search-form";

export const metadata: Metadata = {
  title: "エリア検索",
};

export default function AreaSearchPage() {
  const isPlacesApiConfigured = isPlacesApiKeyConfigured();

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <div>
        <h2 className="text-xl md:text-2xl font-bold text-foreground">
          エリアで店舗を検索
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          エリアやキーワードから飲食店を検索し、営業リストに追加できます。
          登録済み店舗は自動で判定され、未登録店舗は 1 件ずつ、または複数選択して一括追加できます。
        </p>
      </div>
      <AreaSearchForm isPlacesApiConfigured={isPlacesApiConfigured} />
    </div>
  );
}
