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

  /**
   * 指定店舗の直近run一覧を `started_at` 降順で取得する(PR4: `/research/[storeId]`
   * の主表示run選定・過去run一覧表示に使用)。`limit` 省略時は既定件数。
   */
  listForStore(storeId: string, limit?: number): Promise<StoreResearchRun[]>;

  /**
   * `status==="succeeded"` かつ `review_completed_at IS NULL` を満たすrunが
   * 1件以上存在する店舗のidを重複なく返す(PR5, Plan v3.2 §6「要確認」判定)。
   *
   * 「最新runだけを見る」のではなく、該当条件を満たすrunの**存在**を店舗単位で
   * 判定する(新しい失敗runが古い未レビューのsucceeded runを隠さないため、Plan §6)。
   */
  listStoreIdsNeedingReview(): Promise<string[]>;

  /** 部分更新する。存在しない `id` の場合は `null`。 */
  update(id: string, patch: StoreResearchRunPatch): Promise<StoreResearchRun | null>;

  /**
   * **`status === "running"` の run に限り**部分更新する compare-and-swap
   * (PR #180 final merge-blocker fix、F2)。
   *
   * - `status === "running"` → 単一の atomic `UPDATE ... WHERE id = ? AND status = 'running'`
   *   を実行し、更新後の行を返す
   * - run が存在しない、または `status !== "running"` → **1列も書き込まず** `null` を返す
   * - `patch` に更新対象フィールドが1つも無い(全て `undefined`)場合も書き込まず `null`
   *   を返す(呼び出し側のバグ。実際の呼び出しは常に1つ以上のフィールドを渡す)
   *
   * ## なぜ必要か(terminal immutability)
   *
   * `update()` は `SELECT → JS マージ → 全列 SET` の read-modify-write であり、
   * ロックも status 条件も持たない。そのため stuck run を
   * `startResearchRunAction`(`lib/actions/research-run-actions.ts`)が
   * `failed / stuck_run_timeout` へ倒して新 run を作った**後**でも、生き残っていた
   * 旧 Workflow の step が `status: "succeeded"` を書き戻して terminal state を復活
   * させられた(監査 F2、CONFIRMED)。復活した run は
   * `listStoreIdsNeedingReview` に載り、review の一括採用で古い結果が canonical
   * `stores.basic_info` へ入りうる。
   *
   * 部分ユニークインデックス `store_research_runs_running_store_idx` は
   * `WHERE status = 'running'` のみを対象とするため、`succeeded` への復活を防げない。
   *
   * ## 使い分け
   *
   * **Workflow(`workflows/store-research.ts`)由来の write は必ずこちらを使うこと。**
   * review 系 Server Action(採用/却下/スキップ・レビュー完了)は `succeeded` な run を
   * 更新するため対象外で、従来どおり `update()` + `getForUpdate()` の行ロックを使う。
   */
  updateIfRunning(
    id: string,
    patch: StoreResearchRunPatch,
  ): Promise<StoreResearchRun | null>;

  /**
   * 行ロック付き(`SELECT ... FOR UPDATE`)で1行取得する(feat/research-review-write-integrity、
   * MAJOR10)。同一runに対する複数のレビュー書込み操作(採用/却下/スキップ、一括採用、
   * レビュー完了)が並行実行された場合の lost update を防ぐために使う。
   *
   * `repos.transaction()` の `tx.researchRun` 経由で呼ぶこと。トランザクション外
   * (`repos.researchRun.getForUpdate`)で呼んでもロックは当該SELECT文の実行後
   * 即座に解放されるため、複数操作の直列化という目的を果たさない。
   */
  getForUpdate(id: string): Promise<StoreResearchRun | null>;
}
