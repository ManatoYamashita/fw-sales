export {
  STAGES,
  STAGE_IDS,
  findStage,
  type Stage,
  type StageId,
} from "@/types/stage";

import { type StageId } from "@/types/stage";

export const RESEARCH_DONE_STAGES: readonly StageId[] = [
  "調査完了",
  "一次接触準備",
  "DM送信済み",
  "テレアポ済み",
  "反応あり",
  "商談化",
  "見積提出",
  "失注",
  "受注",
  "引き継ぎ待ち",
  "引き継ぎ完了",
];

export const CONTACTED_STAGES: readonly StageId[] = [
  "DM送信済み",
  "テレアポ済み",
  "反応あり",
  "商談化",
  "見積提出",
  "受注",
  "引き継ぎ待ち",
  "引き継ぎ完了",
];

export const NEGOTIATING_STAGES: readonly StageId[] = ["商談化", "見積提出"];

export const ORDERED_STAGES: readonly StageId[] = [
  "受注",
  "引き継ぎ待ち",
  "引き継ぎ完了",
];

export const ACTION_READY_STAGES: readonly StageId[] = [
  "一次接触準備",
];
