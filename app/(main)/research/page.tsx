import type { Metadata } from "next";
import { Tabs, TabsList, TabsTrigger, TabsPanel } from "@/components/ui/tabs";
import { getResearchQueue } from "@/lib/queries/research";
import { WaitingList, DoneList } from "./_components/research-list";

export const metadata: Metadata = {
  title: "調査キュー",
};

export default async function ResearchPage() {
  const queue = await getResearchQueue();
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl md:text-2xl font-bold text-slate-900">
          調査キュー
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          調査待ちの店舗からプランナーが S/W 分析・チャネル判定を行います。
        </p>
      </div>

      <Tabs defaultValue="waiting">
        <TabsList>
          <TabsTrigger value="waiting">
            調査待ち ({queue.waiting.length})
          </TabsTrigger>
          <TabsTrigger value="done">
            調査完了 ({queue.done.length})
          </TabsTrigger>
        </TabsList>
        <TabsPanel value="waiting">
          <WaitingList stores={queue.waiting} />
        </TabsPanel>
        <TabsPanel value="done">
          <DoneList rows={queue.done} />
        </TabsPanel>
      </Tabs>
    </div>
  );
}
