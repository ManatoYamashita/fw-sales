import { Badge } from "@/components/ui/badge";
import {
  CURRENT_SALES_STATE_LABELS,
  type CurrentSalesState,
} from "@/lib/domain/sales-progress";

const TONES: Record<
  CurrentSalesState,
  "success" | "destructive" | "warning" | "info" | "outline"
> = {
  won: "success",
  lost: "destructive",
  estimated: "warning",
  following: "info",
  initial: "info",
  appointment: "success",
  researched: "outline",
  unresearched: "outline",
};

export function SalesStateBadge({ state }: { state: CurrentSalesState }) {
  return <Badge tone={TONES[state]}>{CURRENT_SALES_STATE_LABELS[state]}</Badge>;
}
