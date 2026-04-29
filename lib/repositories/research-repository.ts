import type {
  Research,
  ResearchInput,
  ResearchPatch,
} from "@/types/research";

export interface ResearchRepository {
  list(): Promise<Research[]>;
  get(id: string): Promise<Research | null>;
  getByStoreId(storeId: string): Promise<Research | null>;
  create(input: ResearchInput): Promise<Research>;
  update(id: string, patch: ResearchPatch): Promise<Research | null>;
  delete(id: string): Promise<boolean>;
}
