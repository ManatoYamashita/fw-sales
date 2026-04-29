import "server-only";
import { repos } from "@/lib/repositories";
import type { Store, StoreFilter } from "@/types/store";
import { STAGES, type StageId } from "@/types/stage";

export interface PipelineColumn {
  id: StageId;
  label: string;
  color: string;
  bg: string;
  stores: Store[];
}

export async function getPipelineColumns(
  filter: StoreFilter = {},
): Promise<PipelineColumn[]> {
  const stores = await repos.store.list(filter);
  return STAGES.map((stage) => ({
    id: stage.id,
    label: stage.label,
    color: stage.color,
    bg: stage.bg,
    stores: stores.filter((s) => s.stage === stage.id),
  }));
}

export interface PipelineSummaryRow {
  stage: StageId;
  label: string;
  color: string;
  bg: string;
  count: number;
}

export async function getPipelineSummary(): Promise<PipelineSummaryRow[]> {
  const stores = await repos.store.list();
  return STAGES.map((stage) => ({
    stage: stage.id,
    label: stage.label,
    color: stage.color,
    bg: stage.bg,
    count: stores.filter((s) => s.stage === stage.id).length,
  }));
}
