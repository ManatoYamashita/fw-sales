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

export { db, sql } from "./client";
export type { DbClient, Tx } from "./client";
export { makeDealRepo, dbDealRepo } from "./deal-repository";
export { makeStoreRepo, dbStoreRepo } from "./store-repository";
export { makeResearchRepo, dbResearchRepo } from "./research-repository";
export { makeHandoffRepo, dbHandoffRepo } from "./handoff-repository";
