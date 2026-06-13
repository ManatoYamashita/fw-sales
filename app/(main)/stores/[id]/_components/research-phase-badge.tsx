import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  RESEARCH_PHASE_META,
  type ResearchPhase,
} from "@/lib/domain/store-research-phase";

/**
 * 調査フェーズ (基本情報待ち / 調査可 / 生成済み) を示すバッジ。
 *
 * 虫眼アイコンで「調査の進み具合」軸であることを明示し、営業ステージ (types/stage.ts) の
 * バッジ・select と混同されないようにする。cron ジョブ状態用の `research-status-badge`
 * とも意味が異なる別物。
 */
export function ResearchPhaseBadge({ phase }: { phase: ResearchPhase }) {
  const meta = RESEARCH_PHASE_META[phase];
  return (
    <Badge tone={meta.badgeTone}>
      <Search className="h-3 w-3" aria-hidden />
      {meta.badgeLabel}
    </Badge>
  );
}
