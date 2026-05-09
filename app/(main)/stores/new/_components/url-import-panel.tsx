"use client";

import { useState, useTransition } from "react";
import { Download, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { importFromUrlAction } from "@/lib/actions/url-parse-actions";
import type { AppliedField, ApplyResult, ParsedSource } from "@/lib/url-parser/types";
import {
  confidenceTier,
  confidenceToBg,
  type ConfidenceTier,
} from "@/lib/url-parser/confidence-color";
import { toast } from "@/components/ui/toast";

export interface UrlImportPanelProps {
  /**
   * URL 解析成功時に呼ばれる。
   * - `suggested`: ApplyResult(operator_name 含む)
   * - `html`: 取得済 HTML 全文(`<script>`/`<style>`/`<svg>`/`<noscript>` 除去後)。
   *   `null` のときは取得失敗または未取得。AI 分析機能の入力として再利用される。
   */
  onApply: (suggested: ApplyResult, html: string | null) => void;
}

interface LastImport {
  type: ParsedSource;
  applied: AppliedField[];
  chained: boolean;
  ogpError?: string;
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

export function UrlImportPanel({ onApply }: UrlImportPanelProps) {
  const [url, setUrl] = useState("");
  const [pending, startTransition] = useTransition();
  const [lastImport, setLastImport] = useState<LastImport | null>(null);

  const importNow = () => {
    if (!url.trim()) {
      toast.warn("URL を入力してください");
      return;
    }
    startTransition(async () => {
      try {
        const result = await importFromUrlAction(url, {
          fetchOgp: true,
          recursive: true,
        });
        if (!result.parsed) {
          toast.error("認識できる形式の URL ではありません");
          return;
        }
        const html =
          result.ogp && result.ogp.ok ? (result.ogp.html ?? null) : null;
        onApply(result.suggested, html);
        setLastImport({
          type: result.parsed.type,
          applied: result.applied,
          chained: result.chained,
          ogpError: result.ogp?.ok === false ? result.ogp.error : undefined,
        });

        const hits = result.applied.filter((f) => f.value !== "" && typeof f.confidence === "number");
        const tierCounts = hits.reduce(
          (acc, f) => {
            const tier = confidenceTier(f.confidence);
            acc[tier] = (acc[tier] ?? 0) + 1;
            return acc;
          },
          {} as Record<ConfidenceTier, number>,
        );
        const summary = `${result.applied.length} 項目中 ${hits.length} 項目を取得 (高:${tierCounts.high ?? 0} / 中:${tierCounts.medium ?? 0} / 低:${(tierCounts.low ?? 0) + (tierCounts.very_low ?? 0)})`;
        toast.success(
          result.suggested.name
            ? `「${result.suggested.name}」: ${summary}`
            : summary,
        );
      } catch (e) {
        toast.error(
          e instanceof Error ? e.message : "URL の取得に失敗しました",
        );
      }
    });
  };

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-3">
      <div className="flex items-start gap-2">
        <Download className="h-5 w-5 text-blue-600 mt-0.5 shrink-0" />
        <div>
          <h3 className="text-sm font-semibold text-blue-900">
            URL から自動入力
          </h3>
          <p className="text-xs text-blue-800/80 mt-0.5">
            食べログ・Googleマップの店舗 URL を貼り付けて「読込」を押すと、
            都道府県・市区・店名・住所・口コミ件数などが自動入力されます。
            色付きの背景は信頼度を示します(緑=高、黄=中、赤=要確認)。
          </p>
        </div>
      </div>
      <div className="flex flex-col sm:flex-row gap-2">
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://tabelog.com/... または https://maps.google.com/..."
          className="flex-1"
          aria-label="店舗URL"
        />
        <Button
          variant="primary"
          onClick={importNow}
          disabled={pending}
          className="sm:w-32"
        >
          {pending ? "読込中…" : "読込"}
        </Button>
      </div>
      {lastImport ? (
        <details className="rounded border border-blue-200 bg-white/60 px-3 py-2 text-xs">
          <summary className="flex items-center gap-2 cursor-pointer flex-wrap">
            <Badge tone={lastImport.ogpError ? "amber" : "green"}>
              {lastImport.ogpError ? (
                <AlertTriangle className="h-3 w-3" />
              ) : (
                <CheckCircle2 className="h-3 w-3" />
              )}
              {lastImport.type}
            </Badge>
            {lastImport.chained ? (
              <Badge tone="blue">公式 HP からも補完</Badge>
            ) : null}
            <span className="text-blue-900/80">
              取得状況({
                lastImport.applied.filter((f) => f.value !== "" && typeof f.confidence === "number").length
              }
              / {lastImport.applied.length})
            </span>
            {lastImport.ogpError ? (
              <span className="text-amber-700">
                (OGP: {lastImport.ogpError})
              </span>
            ) : null}
            <span className="text-blue-900/60 ml-auto">▾ 詳細</span>
          </summary>
          <ul className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {lastImport.applied.map((f) => {
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
                    {f.value || <span className="text-gray-500">(取得失敗)</span>}
                  </span>
                  <span className="ml-auto text-[10px] text-gray-600 shrink-0">
                    {tierLabel(tier)}
                    {typeof f.confidence === "number" ? ` ${f.confidence}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
