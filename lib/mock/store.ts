import "server-only";
import type { StoreRepository } from "@/lib/repositories/store-repository";
import type { Store, StoreInput, StorePatch, StoreFilter } from "@/types/store";
import { mockDb } from "./db";
import { generateId } from "@/lib/utils/id";
import { today } from "@/lib/utils/date";

function matches(store: Store, filter: StoreFilter): boolean {
  if (filter.stage && store.stage !== filter.stage) return false;
  if (filter.priority && store.priority !== filter.priority) return false;
  if (filter.channel && store.channel !== filter.channel) return false;
  if (filter.sales && store.assigned_sales !== filter.sales) return false;
  if (filter.q) {
    const q = filter.q.trim().toLowerCase();
    if (!q) return true;
    const haystack = [
      store.name,
      store.city,
      store.prefecture,
      store.address,
      store.genre,
      store.memo,
    ]
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(q)) return false;
  }
  return true;
}

export const mockStoreRepo: StoreRepository = {
  async list(filter = {}) {
    return [...mockDb.stores.values()]
      .filter((s) => matches(s, filter))
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  },

  async get(id) {
    return mockDb.stores.get(id) ?? null;
  },

  async create(input: StoreInput) {
    const now = today();
    const store: Store = {
      ...input,
      id: generateId("store"),
      created_at: now,
      updated_at: now,
    };
    mockDb.stores.set(store.id, store);
    return store;
  },

  async update(id, patch: StorePatch) {
    const current = mockDb.stores.get(id);
    if (!current) return null;
    const next: Store = {
      ...current,
      ...patch,
      updated_at: today(),
    };
    mockDb.stores.set(id, next);
    return next;
  },

  async delete(id) {
    return mockDb.stores.delete(id);
  },
};
