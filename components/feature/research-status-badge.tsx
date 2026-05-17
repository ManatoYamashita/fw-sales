/**
 * Deep Research ジョブ状態 Badge (deep-research-pipeline spec, Issue #43, Task 5.1)
 *
 * 5 状態 (queued / researching / structuring / done / failed) の視覚区別を提供する。
 * 既存 `stage-badge.tsx` のパターンを踏襲し、Badge の `tone` で意味論色を当てる。
 *
 * 関連: requirements.md §2.3, §5.1
 */

import { Badge } from "@/components/ui/badge";
import type { JobStatus } from "@/types/deep-research";

interface ResearchStatusBadgeProps {
  status: JobStatus;
}

const STATUS_META: Record<
  JobStatus,
  { label: string; tone: "info" | "warning" | "success" | "destructive" | "outline" }
> = {
  queued: { label: "キュー待ち", tone: "outline" },
  researching: { label: "リサーチ中", tone: "info" },
  structuring: { label: "構造化中", tone: "info" },
  done: { label: "完了", tone: "success" },
  failed: { label: "失敗", tone: "destructive" },
};

export function ResearchStatusBadge({ status }: ResearchStatusBadgeProps) {
  const meta = STATUS_META[status];
  return (
    <Badge tone={meta.tone} data-status={status}>
      {meta.label}
    </Badge>
  );
}
