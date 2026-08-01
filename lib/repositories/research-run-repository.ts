/**
 * ResearchRunRepository interface (AI 店舗調査再設計 Plan v3.2, PR1: データモデル基盤)
 *
 * `store_research_runs` テーブルへのアクセス契約。PR1 時点では AI パイプライン
 * (Stage1/Stage2 等) がまだ存在しないため、後続 PR (PR2 以降) が必要とする
 * 最低限の CRUD/query のみを定義する。過剰な先回り API は追加しない。
 *
 * 設計上の不変条件:
 * - `create` は `status="running"` で行を作成する。`expires_at` はリポジトリ側で
 *   `started_at` + 既定マージンを計算する (呼び出し側は指定しない)。
 * - `getLatestForStore` は `started_at` 降順で最新1件を返す (Plan §6 の
 *   「要確認」判定 — 最新の成功run選定 — に使用する想定)。
 * - `update` は不変列 (`id` / `store_id` / `requested_by_user_id` / `started_at` /
 *   `expires_at`) を変更しない。存在しない `id` の場合は `null` を返す。
 * - `update` の jsonb 列 (`result` / `source_registry` / `review_decisions` /
 *   `token_usage` / `warnings`) は **列単位の全置換であり、JSON マージではない**
 *   (`stores.basic_info` が `mergeBasicInfo` という専用ドメイン関数でのみ部分更新
 *   されるのと同じ設計思想: マージ責務はリポジトリではなく呼び出し側/ドメイン層が持つ)。
 *   例えば `review_decisions` に1件だけ追記したい場合、呼び出し側は
 *   現在値を `get`/`getLatestForStore` で取得し、マージ済みオブジェクトを
 *   `patch.review_decisions` として渡すこと。
 *
 * 関連: types/research-run.ts, lib/db/research-run-repository.ts, Plan v3.2 §12
 */

import type {
  StoreResearchRun,
  StoreResearchRunInput,
  StoreResearchRunPatch,
} from "@/types/research-run";

export interface ResearchRunRepository {
  /** `store_research_runs` を1行新規作成する。`status="running"` で作成される。 */
  create(input: StoreResearchRunInput): Promise<StoreResearchRun>;

  /** `id` で1行取得する。存在しなければ `null`。 */
  get(id: string): Promise<StoreResearchRun | null>;

  /**
   * 指定店舗の最新run (`started_at` 降順の先頭1件) を取得する。
   * 1件も無ければ `null`。
   */
  getLatestForStore(storeId: string): Promise<StoreResearchRun | null>;

  /** 部分更新する。存在しない `id` の場合は `null`。 */
  update(id: string, patch: StoreResearchRunPatch): Promise<StoreResearchRun | null>;
}
