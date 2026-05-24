/**
 * 調査キューページ (deep-research-pipeline spec, Issue #43)
 *
 * Deep Research ジョブを「実行中 / 完了 / 失敗」の 3 タブで一覧する。
 * スコープはチーム全員横断 (担当者列を表示)。
 *
 * 関連: design.md §Migration Strategy, requirements.md §1.x, §5.x
 */

import type { Metadata } from "next";
import { connection } from "next/server";
import { Tabs, TabsList, TabsTrigger, TabsPanel } from "@/components/ui/tabs";
import {
  listInFlightDeepResearchJobs,
  listRecentDoneDeepResearchJobs,
  listRecentFailedDeepResearchJobs,
} from "@/lib/queries/deep-research";
import { DeepResearchQueueTable } from "./_components/deep-research-queue-table";

export const metadata: Metadata = {
  title: "調査キュー",
};

export default async function ResearchPage() {
  // build 時 prerender を skip (USE_CACHE_TIMEOUT 対策)。
  await connection();

  const [inFlight, done, failed] = await Promise.all([
    listInFlightDeepResearchJobs(),
    listRecentDoneDeepResearchJobs(),
    listRecentFailedDeepResearchJobs(),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl md:text-2xl font-bold text-foreground">
          調査キュー
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Deep Research ジョブの進行状況。 30 分間隔の cron tick で順次処理されます。
        </p>
      </div>

      <Tabs defaultValue="in_flight">
        <TabsList>
          <TabsTrigger value="in_flight">
            実行中 ({inFlight.length})
          </TabsTrigger>
          <TabsTrigger value="done">完了 ({done.length})</TabsTrigger>
          <TabsTrigger value="failed">失敗 ({failed.length})</TabsTrigger>
        </TabsList>
        <TabsPanel value="in_flight">
          <DeepResearchQueueTable rows={inFlight} variant="in_flight" />
        </TabsPanel>
        <TabsPanel value="done">
          <DeepResearchQueueTable rows={done} variant="done" />
        </TabsPanel>
        <TabsPanel value="failed">
          <DeepResearchQueueTable rows={failed} variant="failed" />
        </TabsPanel>
      </Tabs>
    </div>
  );
}
