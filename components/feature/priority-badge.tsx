import { Badge } from "@/components/ui/badge";
import type { Priority } from "@/types/store";

/**
 * 色数最小化の方針: 高=destructive のみ色付き、中/低 は slate ベース
 */
const tone: Record<
  Priority,
  "destructive" | "secondary" | "outline"
> = {
  高: "destructive",
  中: "secondary",
  低: "outline",
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  return <Badge tone={tone[priority] ?? "outline"}>{priority}</Badge>;
}
