import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import type { Metadata } from "next";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { ResearchStatusBadge } from "@/components/feature/research-status-badge";
import { getDeepResearchJobById } from "@/lib/queries/deep-research";
import { formatRelativeTime, formatDuration } from "@/lib/utils/relative-time";
import { JobErrorTimeline } from "./_components/job-error-timeline";
import { JobActionButtons } from "./_components/job-action-buttons";

type Params = Promise<{ jobId: string }>;

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { jobId } = await params;
  return { title: `ジョブ ${jobId}` };
}

export default async function JobDetailPage({
  params,
}: {
  params: Params;
}) {
  await connection();
  const { jobId } = await params;
  const row = await getDeepResearchJobById(jobId);
  if (!row) notFound();

  const { job, store_name, researcher_display_name } = row;

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Link
          href="/research"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← 調査キュー
        </Link>
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-xl font-bold text-foreground">
            {store_name ?? "(削除済み)"}
          </h2>
          <ResearchStatusBadge status={job.status} />
        </div>
        <p className="text-xs text-muted-foreground font-mono">{job.id}</p>
      </div>

      <div className="flex items-center gap-2">
        <JobActionButtons jobId={job.id} status={job.status} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>基本情報</CardTitle>
          </CardHeader>
          <CardBody>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">店舗</dt>
              <dd>
                {store_name ? (
                  <Link
                    href={`/stores/${job.store_id}`}
                    className="text-foreground hover:underline"
                  >
                    {store_name}
                  </Link>
                ) : (
                  "(削除済み)"
                )}
              </dd>
              <dt className="text-muted-foreground">担当者</dt>
              <dd>{researcher_display_name ?? "—"}</dd>
              <dt className="text-muted-foreground">投入時刻</dt>
              <dd title={new Date(job.enqueued_at).toLocaleString("ja-JP")}>
                {formatRelativeTime(job.enqueued_at)}
              </dd>
              {job.research_started_at && (
                <>
                  <dt className="text-muted-foreground">調査開始</dt>
                  <dd>{formatRelativeTime(job.research_started_at)}</dd>
                </>
              )}
              {job.completed_at && (
                <>
                  <dt className="text-muted-foreground">完了/失敗</dt>
                  <dd>{formatRelativeTime(job.completed_at)}</dd>
                </>
              )}
              {job.completed_at && (
                <>
                  <dt className="text-muted-foreground">所要時間</dt>
                  <dd>{formatDuration(job.enqueued_at, job.completed_at)}</dd>
                </>
              )}
              <dt className="text-muted-foreground">試行回数</dt>
              <dd>{job.attempts}</dd>
              {job.deep_research_task_id && (
                <>
                  <dt className="text-muted-foreground">Task ID</dt>
                  <dd className="font-mono text-xs break-all">
                    {job.deep_research_task_id}
                  </dd>
                </>
              )}
              {job.api_updated_at && (
                <>
                  <dt className="text-muted-foreground">API 最終更新</dt>
                  <dd>{formatRelativeTime(job.api_updated_at)}</dd>
                </>
              )}
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>エラーログ</CardTitle>
          </CardHeader>
          <CardBody>
            <JobErrorTimeline errors={job.error_log ?? []} />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
