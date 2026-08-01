import { Badge } from "@/components/ui/badge";
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
