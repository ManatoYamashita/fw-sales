"use client";

import { Tabs, TabsList, TabsTrigger, TabsPanel } from "@/components/ui/tabs";
import { NeedsReviewList, WaitingList, DoneList } from "./research-list";
import type { Store } from "@/types/store";

/**
 * /research の 3 タブ(要確認 / 調査待ち / 調査済み、Plan v3.2 §6, PR5)。
 *
 * データは RSC(page.tsx)が getResearchQueue で取得して渡す。本コンポーネントはタブ切替のみを
 * 担う client。各 List は server-only 依存を持たない純粋な表示コンポーネントのため
 * client 境界内で描画して問題ない。
 */
export function ResearchTabs({
  needsReview,
  waiting,
  done,
}: {
  needsReview: Store[];
  waiting: Store[];
  done: Store[];
}) {
  return (
    <Tabs defaultValue={needsReview.length > 0 ? "needsReview" : "waiting"} variant="pill">
      <TabsList>
        <TabsTrigger value="needsReview">要確認 ({needsReview.length})</TabsTrigger>
        <TabsTrigger value="waiting">調査待ち ({waiting.length})</TabsTrigger>
        <TabsTrigger value="done">調査済み ({done.length})</TabsTrigger>
      </TabsList>
      <TabsPanel value="needsReview">
        <NeedsReviewList stores={needsReview} />
      </TabsPanel>
      <TabsPanel value="waiting">
        <WaitingList stores={waiting} />
      </TabsPanel>
      <TabsPanel value="done">
        <DoneList stores={done} />
      </TabsPanel>
    </Tabs>
  );
}
