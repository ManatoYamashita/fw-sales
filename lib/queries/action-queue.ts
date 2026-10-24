import "server-only";
import { repos } from "@/lib/repositories";
import type { Store } from "@/types/store";
import type { Handoff } from "@/types/handoff";
import { ACTION_READY_STAGES } from "@/lib/domain/stages";

export interface ActionQueue {
  needsResearch: Store[];
  needsAction: Store[];
  pendingHandoffs: Handoff[];
}

export async function getActionQueue(tenantId: string): Promise<ActionQueue> {
  const [stores, handoffs] = await Promise.all([
    repos.forTenant(tenantId).store.list(),
    repos.forTenant(tenantId).handoff.list(),
  ]);

  return {
    needsResearch: stores
      .filter((s) => s.stage === "未調査")
      .slice(0, 5),
    needsAction: stores
      .filter((s) => ACTION_READY_STAGES.includes(s.stage))
      .slice(0, 5),
    pendingHandoffs: handoffs
      .filter((h) => h.status === "運用確認待ち")
      .slice(0, 5),
  };
}
