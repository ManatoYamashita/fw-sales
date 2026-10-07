import { Badge } from "@/components/ui/badge";
import {
  CURRENT_SALES_STATE_LABELS,
  type CurrentSalesState,
} from "@/lib/domain/sales-progress";
import type { Deal } from "@/types/deal";

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

/**
 * 営業状態バッジ + 失注時の再アプローチ可否 (#297)。一覧の表・カード・詳細で共有する。
 *
 * 現場は「（Rアポ）」「（確バツ）」を店舗名に書いて一覧で見分けていた。その代わりに
 * なるよう、失注のときだけバッジの下へ再アプローチ可否を 1 行添える。失注理由は
 * 長文になりうるので一覧には出さず `title` に載せる (詳細は営業進捗タブで読む)。
 *
 * 縦に積むのは列予算 (`stores-table-columns.test.tsx` の salesState) を
 * 広げないため。添える文言はバッジより短い。
 */
export function SalesStateSummary({
  state,
  latestDeal,
}: {
  state: CurrentSalesState;
  latestDeal: Pick<Deal, "reapproach" | "lost_reason"> | null;
}) {
  const lost = state === "lost" ? latestDeal : null;
  return (
    <div className="space-y-1" title={lost?.lost_reason ? `失注理由: ${lost.lost_reason}` : undefined}>
      <SalesStateBadge state={state} />
      {lost ? (
        <p className="text-xs text-muted-foreground">{lost.reapproach ?? "再アプローチ未判断"}</p>
      ) : null}
    </div>
  );
}
