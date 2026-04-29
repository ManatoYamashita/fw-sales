import "server-only";
import type { HandoffRepository } from "@/lib/repositories/handoff-repository";
import type { Handoff, HandoffInput, HandoffPatch } from "@/types/handoff";
import { mockDb } from "./db";
import { generateId } from "@/lib/utils/id";
import { today } from "@/lib/utils/date";

export const mockHandoffRepo: HandoffRepository = {
  async list(storeId) {
    const all = [...mockDb.handoffs.values()].sort((a, b) =>
      a.created_at < b.created_at ? 1 : -1,
    );
    return storeId ? all.filter((h) => h.store_id === storeId) : all;
  },

  async get(id) {
    return mockDb.handoffs.get(id) ?? null;
  },

  async getByDealId(dealId) {
    return (
      [...mockDb.handoffs.values()].find((h) => h.deal_id === dealId) ?? null
    );
  },

  async create(input: HandoffInput) {
    const now = today();
    const handoff: Handoff = {
      ...input,
      id: generateId("hand"),
      created_at: now,
      updated_at: now,
    };
    mockDb.handoffs.set(handoff.id, handoff);
    return handoff;
  },

  async update(id, patch: HandoffPatch) {
    const current = mockDb.handoffs.get(id);
    if (!current) return null;
    const next: Handoff = { ...current, ...patch, updated_at: today() };
    mockDb.handoffs.set(id, next);
    return next;
  },

  async delete(id) {
    return mockDb.handoffs.delete(id);
  },
};
