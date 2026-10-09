import { FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  RESEARCH_PHASE_META,
  type ResearchPhase,
} from "@/lib/domain/store-research-phase";

/**
 * 営業資産の状態 (未生成 / 生成済み) を示すバッジ。
 *
 * #300 以前は虫眼鏡アイコンに「生成済み」とだけ書いており、調査の完了か営業資産の生成かが
 * 読み取れなかった。ラベルに「営業資産」を含め、アイコンも文書 (資産) に替えた。
 * 調査の進み具合は `/research/[storeId]` の手順表示が持つ。営業ステージ (types/stage.ts)
 * のバッジや cron ジョブ状態用の `research-status-badge` とは別物。
 */
export function ResearchPhaseBadge({ phase }: { phase: ResearchPhase }) {
  const meta = RESEARCH_PHASE_META[phase];
  return (
    <Badge tone={meta.badgeTone}>
      <FileText className="h-3 w-3" aria-hidden />
      {meta.badgeLabel}
    </Badge>
  );
}
