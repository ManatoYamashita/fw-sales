import { Badge } from "@/components/ui/badge";
import { findStage, type StageId } from "@/types/stage";

export function StageBadge({ stage }: { stage: StageId }) {
  const meta = findStage(stage);
  if (!meta) {
    return <Badge tone="neutral">{stage || "—"}</Badge>;
  }
  return <Badge swatch={{ bg: meta.bg, color: meta.color }}>{meta.label}</Badge>;
}
