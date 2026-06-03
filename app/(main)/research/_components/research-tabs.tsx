"use client";

import { Tabs, TabsList, TabsTrigger, TabsPanel } from "@/components/ui/tabs";
import { WaitingList, DoneList } from "./research-list";
import type { Store } from "@/types/store";

/**
 * /research の 2 タブ(調査待ち / 調査済み)。
 *
 * データは RSC(page.tsx)が getResearchQueue で取得して渡す。本コンポーネントはタブ切替のみを
 * 担う client。WaitingList / DoneList は server-only 依存を持たない純粋な表示コンポーネントのため
 * client 境界内で描画して問題ない。
 */
export function ResearchTabs({
  waiting,
  done,
}: {
  waiting: Store[];
  done: Store[];
}) {
  return (
    <Tabs defaultValue="waiting" variant="pill">
      <TabsList>
        <TabsTrigger value="waiting">調査待ち ({waiting.length})</TabsTrigger>
        <TabsTrigger value="done">調査済み ({done.length})</TabsTrigger>
      </TabsList>
      <TabsPanel value="waiting">
        <WaitingList stores={waiting} />
      </TabsPanel>
      <TabsPanel value="done">
        <DoneList stores={done} />
      </TabsPanel>
    </Tabs>
  );
}
