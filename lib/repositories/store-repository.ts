import type { Store, StoreInput, StorePatch, StoreFilter } from "@/types/store";

export interface StoreRepository {
  list(filter?: StoreFilter): Promise<Store[]>;
  get(id: string): Promise<Store | null>;
  create(input: StoreInput): Promise<Store>;
  update(id: string, patch: StorePatch): Promise<Store | null>;
  delete(id: string): Promise<boolean>;
}
