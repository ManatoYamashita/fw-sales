import type { Metadata } from "next";
import { AreaSearchForm } from "./_components/area-search-form";

export const metadata: Metadata = {
  title: "エリア検索",
};

export default function AreaSearchPage() {
  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <div>
        <h2 className="text-xl md:text-2xl font-bold text-foreground">
          エリアで店舗を検索
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          キーワードとエリアを入力して Google Places から店舗候補を検索します。
          見つかった店舗を 1 件ずつ営業リストに追加できます。
        </p>
      </div>
      <AreaSearchForm />
    </div>
  );
}
