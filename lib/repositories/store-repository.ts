import type { Store, StoreInput, StorePatch, StoreFilter } from "@/types/store";

export interface StoreRepository {
  list(filter?: StoreFilter): Promise<Store[]>;
  get(id: string): Promise<Store | null>;
  create(input: StoreInput): Promise<Store>;
  update(id: string, patch: StorePatch): Promise<Store | null>;
  delete(id: string): Promise<boolean>;
  /** 指定 ID 群を一括削除し、実際に削除された件数を返す。 */
  bulkDelete(ids: string[]): Promise<number>;
}
