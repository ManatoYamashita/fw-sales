"use client";

/**
 * 出典バッジ(Plan v3.2 §5.3): 技術用語(「URL Context」「grounding」等)を出さず、
 * `url_context_status` を平易な表現に変換して表示する。
 */

import { Badge } from "@/components/ui/badge";
import type { SourceRegistryEntry, UrlContextStatus } from "@/types/research-run";

const LABELS: Record<UrlContextStatus, string> = {
  success: "内容を確認済み",
  not_attempted: "検索結果のみ",
  error: "ページを確認できませんでした",
};

const ICONS: Record<UrlContextStatus, string> = {
  success: "✓",
  not_attempted: "⚠",
  error: "✕",
};

const TONES: Record<UrlContextStatus, "success" | "warning" | "destructive"> = {
  success: "success",
  not_attempted: "warning",
  error: "destructive",
};

export function SourceBadge({ entry }: { entry: SourceRegistryEntry }) {
  const url = entry.resolved_url ?? entry.grounding_redirect_url;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 hover:underline"
      title={entry.title}
    >
      <Badge tone={TONES[entry.url_context_status]}>
        {ICONS[entry.url_context_status]} {LABELS[entry.url_context_status]}
      </Badge>
      <span className="text-xs text-muted-foreground truncate max-w-[12rem]">{entry.title}</span>
    </a>
  );
}

export function SourceBadgeList({
  sourceIds,
  sourceRegistry,
}: {
  sourceIds: readonly string[];
  sourceRegistry: readonly SourceRegistryEntry[];
}) {
  const entries = sourceIds
    .map((id) => sourceRegistry.find((e) => e.id === id))
    .filter((e): e is SourceRegistryEntry => e !== undefined);

  if (entries.length === 0) {
    return <span className="text-xs text-muted-foreground">出典なし</span>;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {entries.map((entry) => (
        <SourceBadge key={entry.id} entry={entry} />
      ))}
    </div>
  );
}
