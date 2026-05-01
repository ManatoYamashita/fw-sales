import { Badge } from "@/components/ui/badge";
import { findStage, type StageId } from "@/types/stage";

/**
 * Stage の配色は globals.css の `[data-stage="<id>"]` ルールが解決する。
 * Light / Dark 両モードに対応するため、トークンを CSS 変数で切り替える方式。
 */
export function StageBadge({ stage }: { stage: StageId }) {
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
