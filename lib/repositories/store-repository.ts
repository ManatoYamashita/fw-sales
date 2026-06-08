import type { Store, StoreInput, StorePatch, StoreFilter } from "@/types/store";
import type { BasicInfo, FillSource } from "@/types/basic-info";

export interface StoreRepository {
  list(filter?: StoreFilter): Promise<Store[]>;
  get(id: string): Promise<Store | null>;
  create(input: StoreInput): Promise<Store>;
  update(id: string, patch: StorePatch): Promise<Store | null>;
  delete(id: string): Promise<boolean>;
  /** 指定 ID 群を一括削除し、実際に削除された件数を返す。 */
  bulkDelete(ids: string[]): Promise<number>;
  /**
   * 店舗の `basic_info`(jsonb)を 1 ソース分の部分更新で原子的にマージする
   * (store-basic-info / Issue #114, #121)。
   *
   * 実装は現在値 read → `mergeBasicInfo` 純関数 (`lib/domain/basic-info-merge.ts`) 適用
   * → write の read-merge-write を 1 文脈で行う(既存 `update` と同じ原子性)。
   * マージ規則の詳細(手動不可侵 / primary 上書き / 空欄補完)は純関数側に集約。
   *
   * @throws 指定 id の店舗が存在しないとき。呼出側 (Action 層) で
   *         `ActionResult.failure` に変換すること。
   * @returns マージ後の `Store`(jsonb 反映 + `updated_at` 更新済)。
   */
  mergeBasicInfo(
    id: string,
    incoming: Partial<BasicInfo>,
    source: FillSource,
  ): Promise<Store>;
}
