export {
  STAGES,
  STAGE_IDS,
  findStage,
  type Stage,
  type StageId,
} from "@/types/stage";

import { type StageId } from "@/types/stage";

export const RESEARCH_DONE_STAGES: readonly StageId[] = [
  "調査済み",
  "DeepResearch済み",
  "架電済み",
];

export const CONTACTED_STAGES: readonly StageId[] = [
  "架電済み",
];

export const ACTION_READY_STAGES: readonly StageId[] = [
  "調査済み",
  "DeepResearch済み",
];
