import "server-only";
import { mockStoreRepo } from "@/lib/mock/store";
import { mockResearchRepo } from "@/lib/mock/research";
import { mockDealRepo } from "@/lib/mock/deal";
import { mockHandoffRepo } from "@/lib/mock/handoff";

/**
 * 全リポジトリの集約。
 * 後日 DB 実装を追加する場合は、このオブジェクトの中身だけ差し替える。
 */
export const repos = {
  store: mockStoreRepo,
  research: mockResearchRepo,
  deal: mockDealRepo,
  handoff: mockHandoffRepo,
} as const;

export type { StoreRepository } from "./store-repository";
export type { ResearchRepository } from "./research-repository";
export type { DealRepository } from "./deal-repository";
export type { HandoffRepository } from "./handoff-repository";
