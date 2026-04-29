import { Badge } from "@/components/ui/badge";
import type { Priority } from "@/types/store";

const tone: Record<Priority, "red" | "amber" | "neutral"> = {
  高: "red",
  中: "amber",
  低: "neutral",
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  return <Badge tone={tone[priority] ?? "neutral"}>{priority}</Badge>;
}
