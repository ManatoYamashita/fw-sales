import "server-only";
import { repos } from "@/lib/repositories";
import { omitContactEmail } from "@/lib/domain/store-contact-email";
import type { Store } from "@/types/store";
import type { Handoff } from "@/types/handoff";
import { ACTION_READY_STAGES } from "@/lib/domain/stages";

export interface ActionQueue {
  needsResearch: Store[];
  needsAction: Store[];
  pendingHandoffs: Handoff[];
}

export async function getActionQueue(): Promise<ActionQueue> {
  const [allStores, handoffs] = await Promise.all([
    repos.store.list(),
    repos.handoff.list(),
  ]);
  // ダッシュボードのカードはアドレスを表示しないため、クライアントへ渡す前に外す (#384)。
  const stores = allStores.map(omitContactEmail);

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
