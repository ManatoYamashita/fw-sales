/**
 * Deep Research セクション (deep-research-pipeline spec #43, Task 5.4)
 *
 * 店舗詳細 page.tsx に AiAnalysisDetailSection の後に並べるセクションカード。
 * design.md 当初は「4 タブ目」を想定していたが、既存 page.tsx がカード集約
 * レイアウト (Tabs 構造なし) のため、カードレベルの新規セクションとして実装する。
 * 内部の 8 カテゴリ切替は `DeepResearchReportView` 内の Tabs プリミティブが担う。
 *
 * 構造:
 * - レポートあり → DeepResearchReportView (内部 8 カテゴリ Tabs)
 * - 進行中ジョブあり → 進行中バッジ + CTA disabled
 * - どちらもなし → CTA active
 *
 * 関連: requirements.md §5.1, §5.2, §7.1, §7.2, §7.3
 */

import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DeepResearchEnqueueButton } from "./deep-research-enqueue-button";
import { DeepResearchJobDetailLink } from "./deep-research-job-detail-link";
import { DeepResearchReportView } from "./deep-research-report-view";
import {
  getDeepResearchReport,
  getDeepResearchJobByStore,
  getLatestDeepResearchJobByStore,
} from "@/lib/queries/deep-research";

interface DeepResearchSectionProps {
  storeId: string;
}

export async function DeepResearchSection({
  storeId,
}: DeepResearchSectionProps) {
  const [report, currentJob, latestJob] = await Promise.all([
    getDeepResearchReport(storeId),
    getDeepResearchJobByStore(storeId),
    getLatestDeepResearchJobByStore(storeId),
  ]);

  const jobDetailId =
    currentJob?.id ?? report?.job_id ?? latestJob?.id ?? null;
  const jobForActions =
    currentJob ?? (latestJob?.status === "failed" ? latestJob : null);

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <CardTitle>Deep Research</CardTitle>
          <p className="text-xs text-muted-foreground">
            8 カテゴリ・51 項目の詳細調査。完了まで数十分〜数時間かかります。
          </p>
          {jobDetailId ? (
            <DeepResearchJobDetailLink jobId={jobDetailId} />
          ) : null}
        </div>
        <DeepResearchEnqueueButton
          storeId={storeId}
          currentJob={jobForActions}
          jobDetailId={jobDetailId}
        />
      </CardHeader>
      {report ? (
        <CardBody>
          <DeepResearchReportView report={report} />
        </CardBody>
      ) : null}
    </Card>
  );
}
