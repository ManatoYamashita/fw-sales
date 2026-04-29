export const STAGES = [
  { id: "調査待ち", label: "調査待ち", color: "#94a3b8", bg: "#f1f5f9" },
  { id: "調査完了", label: "調査完了", color: "#7c3aed", bg: "#ede9fe" },
  { id: "一次接触準備", label: "一次接触準備", color: "#d97706", bg: "#fef3c7" },
  { id: "DM送信済み", label: "DM送信済み", color: "#2563eb", bg: "#dbeafe" },
  { id: "テレアポ済み", label: "テレアポ済み", color: "#0891b2", bg: "#cffafe" },
  { id: "反応あり", label: "反応あり", color: "#16a34a", bg: "#dcfce7" },
  { id: "商談化", label: "商談化", color: "#15803d", bg: "#bbf7d0" },
  { id: "見積提出", label: "見積提出", color: "#f59e0b", bg: "#fde68a" },
  { id: "失注", label: "失注", color: "#dc2626", bg: "#fee2e2" },
  { id: "受注", label: "受注", color: "#166534", bg: "#86efac" },
  { id: "引き継ぎ待ち", label: "引き継ぎ待ち", color: "#9a3412", bg: "#fed7aa" },
  { id: "引き継ぎ完了", label: "引き継ぎ完了", color: "#475569", bg: "#e2e8f0" },
] as const;

export type Stage = (typeof STAGES)[number];
export type StageId = Stage["id"];

export const STAGE_IDS = STAGES.map((s) => s.id) as readonly StageId[];

export function findStage(id: StageId | string): Stage | undefined {
  return STAGES.find((s) => s.id === id);
}
