import { Badge } from "@/components/ui/badge";
import {
  RESEARCH_PHASE_META,
  type ResearchPhase,
} from "@/lib/domain/store-research-phase";

/**
 * 調査フェーズ (未調査 / 調査可 / 生成済み) を示すバッジ。
 *
 * cron ジョブ状態用の `research-status-badge` とは意味が異なるため別物。営業ステージの
 * バッジとも独立して並ぶ。
 */
export function ResearchPhaseBadge({ phase }: { phase: ResearchPhase }) {
  const meta = RESEARCH_PHASE_META[phase];
  return <Badge tone={meta.badgeTone}>{meta.badgeLabel}</Badge>;
}
