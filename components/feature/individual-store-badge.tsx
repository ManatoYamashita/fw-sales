import { User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { OperatorType } from "@/types/store";

/**
 * 個人店判別バッジ。`operator_type === "個人店"` のときだけ表示する。
 *
 * 個人店は法人運営に比べ営業成約率が高い傾向があり、優先度判断のシグナルとして
 * 一覧 / 詳細画面で視覚的に判別できるようにする。`"複数店舗運営"` / `"未設定"`
 * では何も描画しない。
 *
 * 関連: design.md §「IndividualStoreBadge」, requirements.md §1.4
 */
export function IndividualStoreBadge({
  operatorType,
}: {
  operatorType: OperatorType;
}) {
  if (operatorType !== "個人店") return null;
  return (
    <Badge tone="success">
      <User className="h-3 w-3" aria-hidden /> 個人店
    </Badge>
  );
}
