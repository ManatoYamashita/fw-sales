import "server-only";
import type { DealRepository } from "@/lib/repositories/deal-repository";
import type { Deal, DealInput, DealPatch } from "@/types/deal";
import { mockDb } from "./db";
import { generateId } from "@/lib/utils/id";
import { today } from "@/lib/utils/date";

export const mockDealRepo: DealRepository = {
  async list(storeId) {
    const all = [...mockDb.deals.values()].sort((a, b) =>
      a.created_at < b.created_at ? 1 : -1,
    );
    return storeId ? all.filter((d) => d.store_id === storeId) : all;
  },

  async get(id) {
    return mockDb.deals.get(id) ?? null;
  },

  async create(input: DealInput) {
    const now = today();
    const deal: Deal = {
      ...input,
      id: generateId("deal"),
      created_at: now,
      updated_at: now,
    };
    mockDb.deals.set(deal.id, deal);
    return deal;
  },

  async update(id, patch: DealPatch) {
    const current = mockDb.deals.get(id);
    if (!current) return null;
    const next: Deal = { ...current, ...patch, updated_at: today() };
    mockDb.deals.set(id, next);
    return next;
  },

  async delete(id) {
    return mockDb.deals.delete(id);
  },
};
