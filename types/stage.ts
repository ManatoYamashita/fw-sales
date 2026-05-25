export const STAGES = [
  { id: "未調査", label: "未調査", color: "#94a3b8", bg: "#f1f5f9" },
  { id: "調査済み", label: "調査済み", color: "#7c3aed", bg: "#ede9fe" },
  { id: "DeepResearch済み", label: "DeepResearch済み", color: "#2563eb", bg: "#dbeafe" },
  { id: "架電済み", label: "架電済み", color: "#0891b2", bg: "#cffafe" },
] as const;

export type Stage = (typeof STAGES)[number];
export type StageId = Stage["id"];

export const STAGE_IDS = STAGES.map((s) => s.id) as readonly StageId[];

export function findStage(id: StageId | string): Stage | undefined {
  return STAGES.find((s) => s.id === id);
}

export type DisplayStateId = StageId | "DeepResearching...";

const DEEP_RESEARCHING_META = {
  id: "DeepResearching..." as const,
  label: "DeepResearching...",
  color: "#d97706",
  bg: "#fef3c7",
};

export const DISPLAY_STAGES = [...STAGES, DEEP_RESEARCHING_META] as const;

export function findDisplayStage(
  id: DisplayStateId | string,
): (typeof DISPLAY_STAGES)[number] | undefined {
  return DISPLAY_STAGES.find((s) => s.id === id);
}

export function resolveDisplayState(
  dbStage: StageId,
  hasActiveDrJob: boolean,
): DisplayStateId {
  if (hasActiveDrJob && dbStage !== "架電済み") return "DeepResearching...";
  return dbStage;
}
