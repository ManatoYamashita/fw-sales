/**
 * ResearchRepository の Drizzle 実装。
 *
 * 役割:
 * - `lib/repositories/research-repository.ts` の `ResearchRepository` interface を Drizzle で 1:1 実装する
 * - `makeResearchRepo(executor)` ファクトリで `DbClient` または `Tx` を受け取り、
 *   トランザクション境界を呼び出し側 (Action 層) で制御できるようにする
 * - 既定 export `dbResearchRepo` は `db` (singleton) を束縛したインスタンス
 *
 * 制約:
 * - `import "server-only"` を必ず付け、Client バンドルへの混入を防ぐ (Req 9.4)
 * - `ResearchRepository` interface は無修正 (Req 9.5)
 * - ID 形式は `<entity>_<id>` (`res_*`) を維持 (Req 10.1)
 * - `created_at` / `updated_at` は `text` (`YYYY-MM-DD`) を維持 (Req 10.2)
 * - `getByStoreId` は 1 店舗 1 調査 (1:1) を `limit(1)` で実装。複数件存在は Action 層
 *   (`saveResearchAction`) の existing チェックで防止 (research-handoff-db-migration design Q1)
 *
 * 関連: design.md §「`lib/db/research-repository.ts` (新規)」,
 *       requirements.md §1.1, §1.4, §2.1〜2.5, §9.5, §10.1, §10.2
 */

import "server-only";
import { eq, desc } from "drizzle-orm";
import { db, type DbClient, type Tx } from "./client";
import { research } from "./schema";
import type {
  Research,
  ResearchInput,
  ResearchPatch,
} from "@/types/research";
import type { ResearchRepository } from "@/lib/repositories/research-repository";
import { generateId } from "@/lib/utils/id";
import { today } from "@/lib/utils/date";

/**
 * `ResearchRepository` を Drizzle で実装するファクトリ。
 *
 * - `executor` には `db` (singleton) または transaction `tx` を渡せる
 * - 内部状態は持たず、closure には `executor` のみを保持する
 */
export function makeResearchRepo(executor: DbClient | Tx): ResearchRepository {
  return {
    async list() {
      const rows = await executor
        .select()
        .from(research)
        .orderBy(desc(research.created_at));
      return rows as Research[];
    },

    async get(id) {
      const rows = await executor
        .select()
        .from(research)
        .where(eq(research.id, id))
        .limit(1);
      return (rows[0] as Research | undefined) ?? null;
    },

    async getByStoreId(storeId) {
      // 1 店舗 1 調査 (1:1) のセマンティクスを `limit(1)` で担保。
      // 複数件存在時は先頭のみ返却し、データ重複は Action 層で防ぐ。
      const rows = await executor
        .select()
        .from(research)
        .where(eq(research.store_id, storeId))
        .limit(1);
      return (rows[0] as Research | undefined) ?? null;
    },

    async create(input: ResearchInput) {
      const now = today();
      const row: Research = {
        ...input,
        id: generateId("res"),
        created_at: now,
        updated_at: now,
      };
      await executor.insert(research).values(row);
      return row;
    },

    async update(id, patch: ResearchPatch) {
      const current = await executor
        .select()
        .from(research)
        .where(eq(research.id, id))
        .limit(1);
      const head = current[0] as Research | undefined;
      if (!head) return null;
      const next: Research = {
        ...head,
        ...patch,
        updated_at: today(),
      };
      await executor.update(research).set(next).where(eq(research.id, id));
      return next;
    },

    async delete(id) {
      // postgres.js + drizzle の `delete().where(...)` は driver 依存で
      // 戻り値形状が `rowCount` を直接持たない場合があるため、
      // `RETURNING id` を使って削除行の存在を確実に判定する。
      const deleted = await executor
        .delete(research)
        .where(eq(research.id, id))
        .returning({ id: research.id });
      return deleted.length > 0;
    },
  };
}

/**
 * `db` singleton を束縛した既定 `ResearchRepository` インスタンス。
 *
 * トランザクション内では呼び出し側で `makeResearchRepo(tx)` を都度生成して使用する。
 */
export const dbResearchRepo: ResearchRepository = makeResearchRepo(db);
