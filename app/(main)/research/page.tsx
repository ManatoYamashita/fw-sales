import type { Metadata } from "next";
import { getResearchQueue } from "@/lib/queries/research";
import { ResearchTabs } from "./_components/research-tabs";

export const metadata: Metadata = {
  title: "調査",
};

export default async function ResearchPage() {
  const { needsReview, waiting, done } = await getResearchQueue();

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl md:text-2xl font-bold text-foreground">
          調査
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          AIで店舗を調査し、53項目のレビューを経て営業資産を生成します。
        </p>
      </div>

      <ResearchTabs needsReview={needsReview} waiting={waiting} done={done} />
    </div>
  );
}
