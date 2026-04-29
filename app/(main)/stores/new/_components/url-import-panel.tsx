"use client";

import { useState, useTransition } from "react";
import { Download, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { importFromUrlAction } from "@/lib/actions/url-parse-actions";
import type { ApplyResult } from "@/lib/url-parser/types";
import { toast } from "@/components/ui/toast";

export interface UrlImportPanelProps {
  onApply: (suggested: ApplyResult) => void;
}

export function UrlImportPanel({ onApply }: UrlImportPanelProps) {
  const [url, setUrl] = useState("");
  const [pending, startTransition] = useTransition();
  const [lastApplied, setLastApplied] = useState<{
    type: string;
    confidence: string;
    name?: string;
    error?: string;
  } | null>(null);

  const importNow = () => {
    if (!url.trim()) {
      toast.warn("URL を入力してください");
      return;
    }
    startTransition(async () => {
      try {
        const result = await importFromUrlAction(url, { fetchOgp: true });
        if (!result.parsed) {
          toast.error("認識できる形式の URL ではありません");
          return;
        }
        onApply(result.suggested);
        setLastApplied({
          type: result.parsed.type,
          confidence: result.ogp?.ok ? "詳細取得済み" : "URL解析のみ",
          name: result.suggested.name,
          error: result.ogp?.error,
        });
        toast.success(
          result.suggested.name
            ? `「${result.suggested.name}」の情報を反映しました`
            : "URL から取得できる情報を反映しました",
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
            都道府県・市区・店名・口コミ件数などが自動入力されます。
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
      {lastApplied ? (
        <div className="flex items-center gap-2 text-xs flex-wrap">
          <Badge tone={lastApplied.error ? "amber" : "green"}>
            {lastApplied.error ? (
              <AlertTriangle className="h-3 w-3" />
            ) : (
              <CheckCircle2 className="h-3 w-3" />
            )}
            {lastApplied.type}
          </Badge>
          <span className="text-blue-900/80">{lastApplied.confidence}</span>
          {lastApplied.error ? (
            <span className="text-amber-700">
              ({lastApplied.error})
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
