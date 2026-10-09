import { Badge } from "@/components/ui/badge";
import {
  RESEARCH_REVIEW_PENDING,
  type StoreResearchStatus,
} from "@/lib/domain/store-research-status";
import { findStage, type StageId } from "@/types/stage";

export function StageBadge({ stage }: { stage: StageId | string }) {
  const meta = findStage(stage);
  if (!meta) {
    return <Badge tone="default">{stage || "—"}</Badge>;
  }
  return (
    <Badge tone="stage" data-stage={meta.id}>
      {meta.label}
    </Badge>
  );
}

/**
 * 調査状態のバッジ (#299)。レビュー待ちは人の作業が残っている状態なので warning で目立たせ、
 * それ以外は {@link StageBadge} と同じ見た目にする。
 */
export function StoreResearchStatusBadge({ status }: { status: StoreResearchStatus }) {
  if (status === RESEARCH_REVIEW_PENDING) {
    return <Badge tone="warning">{status}</Badge>;
  }
  return <StageBadge stage={status} />;
}
