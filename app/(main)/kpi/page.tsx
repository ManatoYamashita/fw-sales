import type { Metadata } from "next";
import { Card } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";
import { Heading, Text } from "@/components/ui/typography";
import { JapaneseYen, Repeat } from "lucide-react";
import { getKpiSnapshot } from "@/lib/queries/kpi";
import { formatYen } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

export const metadata: Metadata = { title: "KPI分析" };

const FUNNEL_BAR_TONE = [
  "bg-chart-1 text-chart-1-foreground",
  "bg-chart-2 text-chart-2-foreground",
  "bg-chart-3 text-chart-3-foreground",
  "bg-chart-4 text-chart-4-foreground",
  "bg-chart-5 text-chart-5-foreground",
];

export default async function KpiPage() {
  const snapshot = await getKpiSnapshot();
  const maxFunnel = Math.max(...snapshot.funnel.map((s) => s.count), 1);
  const maxChannel = Math.max(
    ...snapshot.channelBreakdown.map((c) => c.count),
    1,
  );
  const maxService = Math.max(
    ...snapshot.serviceBreakdown.map((s) => s.count),
    1,
  );

  return (
    <div className="space-y-6">
      <div>
        <Heading level={1}>KPI分析</Heading>
        <Text variant="muted" className="mt-1">
          営業ファネルの変換率・チャネル内訳・提案商材を可視化します。
        </Text>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Stat
          label="累計初期売上"
          value={formatYen(snapshot.totalRevenue)}
          icon={<JapaneseYen />}
          tone="success"
        />
        <Stat
          label="月額(運用中)"
          value={formatYen(snapshot.monthlyRecurring)}
          icon={<Repeat />}
          tone="primary"
        />
      </div>

      <Card>
        <Card.Header>
          <Card.Title>営業ファネル</Card.Title>
        </Card.Header>
        <Card.Body className="@container">
          <ul className="space-y-3">
            {snapshot.funnel.map((step, i) => {
              const tone =
                FUNNEL_BAR_TONE[i % FUNNEL_BAR_TONE.length] ?? "bg-chart-1";
              const ratio = (step.count / maxFunnel) * 100;
              return (
                <li key={step.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 @min-[430px]:grid-cols-[5rem_minmax(0,1fr)_4rem]">
                  <span className="min-w-0 text-sm font-medium text-foreground">
                    {step.label}
                  </span>
                  <div className="col-span-2 row-start-2 h-7 min-w-0 overflow-hidden rounded-md bg-muted @min-[430px]:col-span-1 @min-[430px]:col-start-2 @min-[430px]:row-start-1">
                    <div
                      className={cn(
                        "h-full flex items-center px-2 text-xs font-semibold",
                        tone,
                      )}
                      style={{
                        width: `${ratio}%`,
                        minWidth: step.count > 0 ? "44px" : 0,
                      }}
                    >
                      {step.count}
                    </div>
                  </div>
                  <span className="col-start-2 row-start-1 text-right text-xs tabular-nums text-muted-foreground @min-[430px]:col-start-3">
                    {i === 0 ? "—" : `${step.rate}%`}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card.Body>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <Card.Header>
            <Card.Title>チャネル内訳</Card.Title>
          </Card.Header>
          <Card.Body className="@container">
            <ul className="space-y-2">
              {snapshot.channelBreakdown.map((row, i) => {
                const tone =
                  FUNNEL_BAR_TONE[i % FUNNEL_BAR_TONE.length] ?? "bg-chart-1";
                return (
                  <li key={row.channel} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-2 gap-y-1 @min-[430px]:grid-cols-[6rem_minmax(0,1fr)_3rem_3rem]">
                    <span className="min-w-0 text-sm text-foreground [overflow-wrap:anywhere]">
                      {row.channel}
                    </span>
                    <div className="col-span-3 row-start-2 h-2 min-w-0 overflow-hidden rounded-full bg-muted @min-[430px]:col-span-1 @min-[430px]:col-start-2 @min-[430px]:row-start-1">
                      <div
                        className={cn("h-full rounded-full", tone)}
                        style={{
                          width: `${(row.count / maxChannel) * 100}%`,
                          minWidth: row.count > 0 ? "8px" : 0,
                        }}
                      />
                    </div>
                    <span className="col-start-2 row-start-1 text-right text-xs tabular-nums text-foreground font-semibold @min-[430px]:col-start-3">
                      {row.count}
                    </span>
                    <span className="col-start-3 row-start-1 text-right text-xs tabular-nums text-muted-foreground @min-[430px]:col-start-4">
                      {row.share}%
                    </span>
                  </li>
                );
              })}
            </ul>
          </Card.Body>
        </Card>

        <Card>
          <Card.Header>
            <Card.Title>提案商材内訳</Card.Title>
          </Card.Header>
          <Card.Body className="@container">
            <ul className="space-y-2">
              {snapshot.serviceBreakdown.map((row, i) => {
                const tone =
                  FUNNEL_BAR_TONE[i % FUNNEL_BAR_TONE.length] ?? "bg-chart-1";
                return (
                  <li key={row.service} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 @min-[430px]:grid-cols-[6rem_minmax(0,1fr)_3rem]">
                    <span className="min-w-0 text-sm text-foreground [overflow-wrap:anywhere]">
                      {row.service}
                    </span>
                    <div className="col-span-2 row-start-2 h-2 min-w-0 overflow-hidden rounded-full bg-muted @min-[430px]:col-span-1 @min-[430px]:col-start-2 @min-[430px]:row-start-1">
                      <div
                        className={cn("h-full rounded-full", tone)}
                        style={{
                          width: `${(row.count / maxService) * 100}%`,
                          minWidth: row.count > 0 ? "8px" : 0,
                        }}
                      />
                    </div>
                    <span className="col-start-2 row-start-1 text-right text-xs tabular-nums text-foreground font-semibold @min-[430px]:col-start-3">
                      {row.count}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Card.Body>
        </Card>
      </div>
    </div>
  );
}
