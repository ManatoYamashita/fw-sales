/**
 * `lib/db` バレル (re-export 集約モジュール)。
 *
 * 役割:
 * - リポジトリ層 (`lib/repositories/*`) が動的 import (`await import("@/lib/db")`)
 *   経由で参照する公開 API を 1 つのエントリポイントに集約する。
 * - 個別ファイル (`./client`, `./deal-repository`, `./store-repository`) を
 *   呼び出し側に意識させず、将来的な内部リファクタを安全に行うための窓口。
 *
 * 制約:
 * - `import "server-only"` を冒頭に置き、Client バンドルへの混入を二重に防ぐ
 *   (`./client` 自体も同指定を持つが、このバレルを直接 import するルートが
 *   増えても安全であるよう保険を掛ける)。
 * - 型のみのシンボル (`DbClient` / `Tx`) は `export type` で明示し、
 *   `isolatedModules: true` 設定下でバンドラがランタイム参照と区別できるようにする。
 * - 本ファイルは re-export のみ責務とし、ロジックは含めない。
 *
 * 関連: design.md §「Components and Interfaces / Summary」,
 *       requirements.md §9.4
 */

import "server-only";

export { auditDb } from "./audit-client";
export { db, sql } from "./client";
export { makeEventLogRepo } from "./event-log-repository";
export type { DbClient, Tx } from "./client";
export { makeDealRepo } from "./deal-repository";
export { makeStoreRepo } from "./store-repository";
export { makeHandoffRepo } from "./handoff-repository";
export { makeProfileRepo } from "./profile-repository";
export { makeMembershipRepo } from "./membership-repository";
export {
  makeNotificationRepo,
} from "./notification-repository";
export {
  makePromptTemplateRepo,
} from "./prompt-template-repository";
export {
  makeAppSettingsRepo,
} from "./app-settings-repository";
export {
  makePlaceCandidateRepo,
} from "./place-candidate-repository";
export {
  makeResearchRunRepo,
} from "./research-run-repository";

export { makeDataRepo } from "./data-repository";
