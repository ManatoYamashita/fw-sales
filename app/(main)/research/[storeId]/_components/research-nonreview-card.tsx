"use client";

/**
 * レビュー対象外item(not_found / hearing_required / external_data_required)の
 * 読み取り専用カード(Plan v3.2 §5.5)。採用/却下操作は持たない(Plan §15)。
 *
 * 注記: Plan §5.5 のワイヤーフレームは項目ごとの具体的な「営業時の質問例」テキストを
 * 想定しているが、現行の AI Research Pipeline(PR2 `buildNonAiItems`)は
 * 項目共通の定型説明文(`item.evidence`)のみを生成し、個別の質問文は生成しない。
 * 本コンポーネントは実装済みのデータ形状に合わせ、`item.evidence` をそのまま表示する。
 */

import { useState } from "react";
import { Copy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toast";
import type { ResearchItem } from "@/types/research-run";

const STATUS_META: Record<
  string,
  { label: string; tone: "secondary" | "info" | "warning"; icon: string }
> = {
  not_found: { label: "確認できず", tone: "secondary", icon: "" },
  hearing_required: { label: "ヒアリング必要", tone: "info", icon: "" },
  external_data_required: { label: "外部データ必要", tone: "warning", icon: "ℹ" },
};

export function NonReviewItemCard({ item, label }: { item: ResearchItem; label: string }) {
  const [copied, setCopied] = useState(false);
  const meta = STATUS_META[item.status] ?? { label: item.status, tone: "secondary" as const, icon: "" };

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(item.evidence);
      setCopied(true);
      toast.success("コピーしました");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("コピーに失敗しました");
    }
  };

  return (
    <div className="border border-border rounded-lg p-4 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <Badge tone={meta.tone}>
          {meta.icon} {meta.label}
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground leading-relaxed">{item.evidence}</p>
      {item.status === "hearing_required" && (
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <Copy className="h-3 w-3" />
          {copied ? "コピーしました" : "この説明をコピー"}
        </button>
      )}
    </div>
  );
}
