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
  "bg-chart-1",
  "bg-chart-2",
  "bg-chart-3",
  "bg-chart-4",
  "bg-chart-5",
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
        <Card.Body>
          <ul className="space-y-3">
            {snapshot.funnel.map((step, i) => {
              const tone =
                FUNNEL_BAR_TONE[i % FUNNEL_BAR_TONE.length] ?? "bg-chart-1";
              const ratio = (step.count / maxFunnel) * 100;
              return (
                <li key={step.label} className="flex items-center gap-3">
                  <span className="w-20 text-sm font-medium text-foreground">
                    {step.label}
                  </span>
                  <div className="flex-1 h-7 rounded-md bg-muted overflow-hidden">
                    <div
                      className={cn(
                        "h-full flex items-center px-2 text-xs font-semibold text-white",
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
                  <span className="w-16 text-right text-xs tabular-nums text-muted-foreground">
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
          <Card.Body>
            <ul className="space-y-2">
              {snapshot.channelBreakdown.map((row, i) => {
                const tone =
                  FUNNEL_BAR_TONE[i % FUNNEL_BAR_TONE.length] ?? "bg-chart-1";
                return (
                  <li key={row.channel} className="flex items-center gap-3">
                    <span className="w-24 text-sm text-foreground">
                      {row.channel}
                    </span>
                    <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className={cn("h-full rounded-full", tone)}
                        style={{
                          width: `${(row.count / maxChannel) * 100}%`,
                          minWidth: row.count > 0 ? "8px" : 0,
                        }}
                      />
                    </div>
                    <span className="w-12 text-right text-xs tabular-nums text-foreground font-semibold">
                      {row.count}
                    </span>
                    <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">
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
          <Card.Body>
            <ul className="space-y-2">
              {snapshot.serviceBreakdown.map((row, i) => {
                const tone =
                  FUNNEL_BAR_TONE[i % FUNNEL_BAR_TONE.length] ?? "bg-chart-1";
                return (
                  <li key={row.service} className="flex items-center gap-3">
                    <span className="w-24 text-sm text-foreground">
                      {row.service}
                    </span>
                    <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className={cn("h-full rounded-full", tone)}
                        style={{
                          width: `${(row.count / maxService) * 100}%`,
                          minWidth: row.count > 0 ? "8px" : 0,
                        }}
                      />
                    </div>
                    <span className="w-12 text-right text-xs tabular-nums text-foreground font-semibold">
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
