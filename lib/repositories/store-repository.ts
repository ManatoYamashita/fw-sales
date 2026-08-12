import type {
  Store,
  StoreDeleteImpact,
  StoreInput,
  StorePatch,
  StoreFilter,
} from "@/types/store";
import type { BasicInfo, FillSource } from "@/types/basic-info";
import type { PlacesBounds } from "@/lib/places/match-store";

export interface StoreRepository {
  list(filter?: StoreFilter): Promise<Store[]>;
  /**
   * エリア検索の照合に必要な候補店舗だけを返す (M4 / Issue #129)。
   *
   * - `googlePlaceIds` に含まれる `google_place_id` を持つ登録済み店舗
   * - OR `google_place_id IS NULL` かつ `bounds` 内に座標がある手動登録店舗
   *
   * 両配列/boundsが空/未指定の場合は DB に問い合わせず `[]` を返す。
   */
  findAreaSearchCandidates(params: {
    googlePlaceIds: string[];
    bounds?: PlacesBounds;
  }): Promise<Store[]>;
  get(id: string): Promise<Store | null>;
  create(input: StoreInput): Promise<Store>;
  update(id: string, patch: StorePatch): Promise<Store | null>;
  delete(id: string): Promise<boolean>;
  /** 指定 ID 群を一括削除し、実際に削除された件数を返す。 */
  bulkDelete(ids: string[]): Promise<number>;
  /**
   * 指定 ID 群の店舗に紐づく子データのカテゴリ別件数を返す
   * (store-cascade-delete / Issue #152)。削除確認ダイアログの影響表示用。
   *
   * - `ids` が空配列のときは DB へ問い合わせず全カテゴリ 0 を返す
   * - 存在しない ID は 0 件として扱われる (エラーにしない)
   * - 読み取りのみでデータ・キャッシュの状態を変更しない
   */
  getDeleteImpact(ids: readonly string[]): Promise<StoreDeleteImpact>;
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

  /**
   * 行ロック付き(`SELECT ... FOR UPDATE`)で1行取得する
   * (feat/ai-research-quality-ux-hardening、Plan 12.2.2)。
   *
   * `ResearchRunRepository.getForUpdate` と完全に同じパターン。
   *
   * ## なぜ必要か
   *
   * `update` / `mergeBasicInfo` はいずれも「現在値 read -> マージ -> **全列 SET** write」
   * であり、read と write の間に行ロックが無い。`stores.basic_info` を書く経路は
   * 複数あり(手動編集 / 個別採用 / 一括採用 / 残りを採用して完了)、
   * これらが並行実行されると後着が先着を丸ごと巻き戻す lost update が起こる。
   * とくに「残りを採用して調査完了」は約30 key を一度に書くため、失われる量が大きい。
   *
   * run 行ロック(`ResearchRunRepository.getForUpdate`)は `runId` 単位のため、
   * 別 run・別経路からの `stores` 書込みとは直列化されない。
   *
   * ## 使い方
   *
   * **`repos.transaction()` の `tx.store` 経由で呼ぶこと。** トランザクション外で
   * 呼んでもロックは当該 SELECT 文の実行後すぐ解放され、目的を果たさない。
   *
   * ## lock order
   *
   * review 系 action は `store_research_runs` -> `stores` の順でロックを取る。
   * `stores` -> `store_research_runs` の順で明示ロックを取る transaction は存在しない。
   * 本メソッドの追加は、**同一トランザクション内で `stores` 行ロックの取得を
   * UPDATE 時点から SELECT 時点へ前倒しするだけ**でロック順序を変えないため、
   * 新しい deadlock クラスを作らない。
   */
  getForUpdate(id: string): Promise<Store | null>;
}
