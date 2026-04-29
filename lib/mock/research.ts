import "server-only";
import type { ResearchRepository } from "@/lib/repositories/research-repository";
import type {
  Research,
  ResearchInput,
  ResearchPatch,
} from "@/types/research";
import { mockDb } from "./db";
import { generateId } from "@/lib/utils/id";
import { today } from "@/lib/utils/date";

export const mockResearchRepo: ResearchRepository = {
  async list() {
    return [...mockDb.research.values()].sort((a, b) =>
      a.created_at < b.created_at ? 1 : -1,
    );
  },

  async get(id) {
    return mockDb.research.get(id) ?? null;
  },

  async getByStoreId(storeId) {
    return (
      [...mockDb.research.values()].find((r) => r.store_id === storeId) ?? null
    );
  },

  async create(input: ResearchInput) {
    const now = today();
    const research: Research = {
      ...input,
      id: generateId("res"),
      created_at: now,
      updated_at: now,
    };
    mockDb.research.set(research.id, research);
    return research;
  },

  async update(id, patch: ResearchPatch) {
    const current = mockDb.research.get(id);
    if (!current) return null;
    const next: Research = { ...current, ...patch, updated_at: today() };
    mockDb.research.set(id, next);
    return next;
  },

  async delete(id) {
    return mockDb.research.delete(id);
  },
};
