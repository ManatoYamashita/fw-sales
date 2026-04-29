import type { Deal, DealInput, DealPatch } from "@/types/deal";

export interface DealRepository {
  list(storeId?: string): Promise<Deal[]>;
  get(id: string): Promise<Deal | null>;
  create(input: DealInput): Promise<Deal>;
  update(id: string, patch: DealPatch): Promise<Deal | null>;
  delete(id: string): Promise<boolean>;
}
