import type { Metadata } from "next";
import { connection } from "next/server";
import { getResearchQueue } from "@/lib/queries/research";
import { AddResearchStoreForm } from "./_components/add-research-store-form";
import { ResearchTabs } from "./_components/research-tabs";

export const metadata: Metadata = {
  title: "調査キュー",
};

export default async function ResearchPage() {
  // build 時 prerender を skip (USE_CACHE_TIMEOUT 対策)。
  await connection();
  const { waiting, done } = await getResearchQueue();

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl md:text-2xl font-bold text-foreground">
          調査キュー
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          調査対象を登録し、Gemini の DeepResearch 結果を貼り付けて構造化・架電生成します。
        </p>
      </div>

      <AddResearchStoreForm />

      <ResearchTabs waiting={waiting} done={done} />
    </div>
  );
}
