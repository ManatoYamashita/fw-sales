"use client";

import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  confidenceTier,
  confidenceToBg,
  type ConfidenceTier,
} from "@/lib/url-parser/confidence-color";
import type { AppliedField, ParsedSource } from "@/lib/url-parser/types";

export interface UrlImportSummaryProps {
  sourceType: ParsedSource;
  applied: readonly AppliedField[];
  chained: boolean;
  ogpError?: string;
  storeName?: string;
}

const TIER_ICON: Record<ConfidenceTier, "high" | "medium" | "low" | "missing"> = {
  high: "high",
  medium: "medium",
  low: "low",
  very_low: "low",
  missing: "missing",
};

function tierLabel(tier: ConfidenceTier): string {
  switch (tier) {
    case "high":
      return "高";
    case "medium":
      return "中";
    case "low":
      return "低";
    case "very_low":
      return "要確認";
    case "missing":
      return "未取得";
  }
}

/**
 * URL 読込結果のサマリカード。
 * 取得状況(N項目中M項目)・信頼度別バッジ・各フィールドの取得結果を一覧表示する。
 */
export function UrlImportSummary({
  sourceType,
  applied,
  chained,
  ogpError,
  storeName,
}: UrlImportSummaryProps) {
  const hits = applied.filter(
    (f) => f.value !== "" && typeof f.confidence === "number",
  );
  const tierCounts = hits.reduce(
    (acc, f) => {
      const tier = confidenceTier(f.confidence);
      acc[tier] = (acc[tier] ?? 0) + 1;
      return acc;
    },
    {} as Record<ConfidenceTier, number>,
  );

  return (
    <Card>
      <Card.Body className="space-y-3">
        <details className="text-xs">
          <summary className="flex items-center gap-2 cursor-pointer flex-wrap">
            <Badge tone={ogpError ? "amber" : "green"}>
              {ogpError ? (
                <AlertTriangle className="h-3 w-3" />
              ) : (
                <CheckCircle2 className="h-3 w-3" />
              )}
              {sourceType}
            </Badge>
            {chained ? <Badge tone="blue">公式 HP からも補完</Badge> : null}
            {storeName ? (
              <span className="text-sm font-medium text-foreground">
                {storeName}
              </span>
            ) : null}
            <span className="text-muted-foreground">
              取得状況 ({hits.length} / {applied.length} · 高:
              {tierCounts.high ?? 0} / 中:{tierCounts.medium ?? 0} / 低:
              {(tierCounts.low ?? 0) + (tierCounts.very_low ?? 0)})
            </span>
            {ogpError ? (
              <span className="text-amber-700">(OGP: {ogpError})</span>
            ) : null}
            <span className="text-muted-foreground ml-auto">▾ 詳細</span>
          </summary>
          <ul className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {applied.map((f) => {
              const tier = confidenceTier(f.confidence);
              const bg = confidenceToBg(f.confidence);
              const icon = TIER_ICON[tier];
              return (
                <li
                  key={f.key}
                  className="flex items-center gap-2 px-2 py-1 rounded text-[11px]"
                  style={bg ? { backgroundColor: bg } : undefined}
                >
                  {icon === "high" || icon === "medium" || icon === "low" ? (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-700" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                  )}
                  <span className="font-medium shrink-0">{f.label}:</span>
                  <span className="truncate">
                    {f.value || (
                      <span className="text-gray-500">(取得失敗)</span>
                    )}
                  </span>
                  <span className="ml-auto text-[10px] text-muted-foreground shrink-0">
                    {tierLabel(tier)}
                    {typeof f.confidence === "number" ? ` ${f.confidence}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        </details>
      </Card.Body>
    </Card>
  );
}
