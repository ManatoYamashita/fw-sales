import type { Metadata } from "next";
import { Card } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";
import { JapaneseYen, Repeat } from "lucide-react";
import { getKpiSnapshot } from "@/lib/queries/kpi";
import { formatYen } from "@/lib/utils/format";

export const metadata: Metadata = { title: "KPI分析" };

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
    <div className="space-y-4">
      <div>
        <h2 className="text-xl md:text-2xl font-bold text-slate-900">KPI分析</h2>
        <p className="text-sm text-slate-500 mt-1">
          営業ファネルの変換率・チャネル内訳・提案商材を可視化します。
        </p>
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
            {snapshot.funnel.map((step, i) => (
              <li key={step.label} className="flex items-center gap-3">
                <span className="w-20 text-sm font-medium text-slate-700">
                  {step.label}
                </span>
                <div className="flex-1 h-7 rounded-md bg-slate-100 overflow-hidden">
                  <div
                    className="h-full bg-blue-500/80 flex items-center px-2 text-xs font-semibold text-white"
                    style={{
                      width: `${(step.count / maxFunnel) * 100}%`,
                      minWidth: step.count > 0 ? "44px" : 0,
                    }}
                  >
                    {step.count}
                  </div>
                </div>
                <span className="w-16 text-right text-xs tabular-nums text-slate-500">
                  {i === 0 ? "—" : `${step.rate}%`}
                </span>
              </li>
            ))}
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
              {snapshot.channelBreakdown.map((row) => (
                <li key={row.channel} className="flex items-center gap-3">
                  <span className="w-24 text-sm text-slate-700">
                    {row.channel}
                  </span>
                  <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-purple-500"
                      style={{
                        width: `${(row.count / maxChannel) * 100}%`,
                        minWidth: row.count > 0 ? "8px" : 0,
                      }}
                    />
                  </div>
                  <span className="w-12 text-right text-xs tabular-nums text-slate-700 font-semibold">
                    {row.count}
                  </span>
                  <span className="w-12 text-right text-xs tabular-nums text-slate-500">
                    {row.share}%
                  </span>
                </li>
              ))}
            </ul>
          </Card.Body>
        </Card>

        <Card>
          <Card.Header>
            <Card.Title>提案商材内訳</Card.Title>
          </Card.Header>
          <Card.Body>
            <ul className="space-y-2">
              {snapshot.serviceBreakdown.map((row) => (
                <li key={row.service} className="flex items-center gap-3">
                  <span className="w-24 text-sm text-slate-700">
                    {row.service}
                  </span>
                  <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-amber-500"
                      style={{
                        width: `${(row.count / maxService) * 100}%`,
                        minWidth: row.count > 0 ? "8px" : 0,
                      }}
                    />
                  </div>
                  <span className="w-12 text-right text-xs tabular-nums text-slate-700 font-semibold">
                    {row.count}
                  </span>
                </li>
              ))}
            </ul>
          </Card.Body>
        </Card>
      </div>
    </div>
  );
}
