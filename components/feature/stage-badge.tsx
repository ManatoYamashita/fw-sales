import { Badge } from "@/components/ui/badge";
import { findDisplayStage, type DisplayStateId } from "@/types/stage";

export function StageBadge({ stage }: { stage: DisplayStateId | string }) {
  const meta = findDisplayStage(stage);
  if (!meta) {
    return <Badge tone="default">{stage || "—"}</Badge>;
  }
  return (
    <Badge tone="stage" data-stage={meta.id}>
      {meta.label}
    </Badge>
  );
}
