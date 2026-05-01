import { Badge } from "@/components/ui/badge";
import type { Priority } from "@/types/store";

const tone: Record<
  Priority,
  "destructive" | "warning" | "secondary"
> = {
  高: "destructive",
  中: "warning",
  低: "secondary",
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  return <Badge tone={tone[priority] ?? "secondary"}>{priority}</Badge>;
}
