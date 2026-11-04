import type { DbSnapshot } from "@/lib/db/snapshot";

/** 所属を束縛したデータ移送。各操作全体を1 transactionとして適用する。 */
export interface DataRepository {
  importSnapshot(snapshot: Partial<DbSnapshot>): Promise<void>;
  clear(): Promise<void>;
  resetToSeed(): Promise<void>;
}
