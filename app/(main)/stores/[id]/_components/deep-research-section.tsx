/**
 * Deep Research セクション (deep-research-pipeline spec #43, Task 5.4)
 *
 * 店舗詳細 page.tsx に AiAnalysisDetailSection の後に並べるセクションカード。
 * design.md 当初は「4 タブ目」を想定していたが、既存 page.tsx がカード集約
 * レイアウト (Tabs 構造なし) のため、カードレベルの新規セクションとして実装する。
 * 内部の 8 カテゴリ切替は `DeepResearchReportView` 内の Tabs プリミティブが担う。
 *
 * 手動貼付フロー (Issue #102) への移行に伴い、自動キュー投入 (DeepResearchEnqueueButton)
 * と旧ジョブ詳細リンク (DeepResearchJobDetailLink) は撤去し、貼付ワークベンチ
 * (`/research/[storeId]`) への導線に置き換えた。表示は `DeepResearchReportView` のみ。
 *
 * 構造:
 * - レポートあり → DeepResearchReportView (内部 8 カテゴリ Tabs) + 「貼付ワークベンチを開く」
 * - レポートなし → 「結果を貼り付ける」導線のみ
 */

import Link from "next/link";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DeepResearchReportView } from "./deep-research-report-view";
import { getDeepResearchReport } from "@/lib/queries/deep-research";

interface DeepResearchSectionProps {
  storeId: string;
}

export async function DeepResearchSection({
  storeId,
}: DeepResearchSectionProps) {
  const report = await getDeepResearchReport(storeId);

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <CardTitle>Deep Research</CardTitle>
          <p className="text-xs text-muted-foreground">
            8 カテゴリ・51 項目の詳細調査。Gemini の DeepResearch 結果を貼付ワークベンチに貼り付けて作成します。
          </p>
        </div>
        <Link
          href={`/research/${storeId}`}
          className="inline-flex h-9 items-center px-3 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          {report ? "貼付ワークベンチを開く" : "結果を貼り付ける"}
        </Link>
      </CardHeader>
      {report ? (
        <CardBody>
          <DeepResearchReportView report={report} />
        </CardBody>
      ) : null}
    </Card>
  );
}
