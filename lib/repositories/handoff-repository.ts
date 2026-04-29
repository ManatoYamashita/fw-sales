import type { Handoff, HandoffInput, HandoffPatch } from "@/types/handoff";

export interface HandoffRepository {
  list(storeId?: string): Promise<Handoff[]>;
  get(id: string): Promise<Handoff | null>;
  getByDealId(dealId: string): Promise<Handoff | null>;
  create(input: HandoffInput): Promise<Handoff>;
  update(id: string, patch: HandoffPatch): Promise<Handoff | null>;
  delete(id: string): Promise<boolean>;
}
