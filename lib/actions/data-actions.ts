"use server";

/**
 * データ移送 Server Actions (Reset / Clear / Import / Export Snapshot)
 *
 * 役割:
 * - Settings 画面から呼ばれる Reset / Clear / Import の env 分岐エントリ。
 * - Mock モード (`USE_MOCK_DB=true`) では従来通り `lib/mock/db` の SEED 全エンティティ
 *   を取り扱う。DB モードでは `stores` / `deals` のみ DB へ直接適用し、
 *   Research / Handoff は引き続き Mock 越しに復元する (Req 8.4)。
 *
 * 制約 / 例外:
 * - 本ファイルは design.md の "Allowed Dependencies / Documented exception" に
 *   従い、`lib/db/client.ts` (`db`) と `lib/db/schema.ts` (`stores` / `deals`) を
 *   参照する。これは TRUNCATE / BULK UPSERT 等 Repository interface で
 *   表現できない DDL 級操作を扱うための data-actions.ts と scripts/seed.ts
 *   限定の例外であり、他ファイルでは追加してはならない。
 * - ただし `lib/db/client.ts` は読み込み時に `assertEnv("DATABASE_URL")` を
 *   発火させる副作用があるため、Mock モード (`USE_MOCK_DB=true` かつ
 *   `DATABASE_URL` 未設定) でも本ファイルを安全に評価できるよう、
 *   `lib/db/*` は **DB 分岐内での動的 import** に限定する (Req 5.3 / Issue 2)。
 *   `await import("@/lib/db/client")` / `await import("@/lib/db/schema")` の
 *   import 文字列は Next.js のバンドル解析性のため必ず文字列リテラルで記述すること。
 * - 既存の Server Action シグネチャ (`resetToSeedAction()` /
 *   `clearAllAction()` / `importJsonAction(_prev, formData)` /
 *   `getSnapshotForExportAction()`) と戻り値型は無修正で維持する (Req 9.1)。
 * - `next/cache` の `revalidateTag(_, "max")` 失効規約も従前の通り。
 *
 * 関連: requirements.md §8.2–8.5、design.md §「lib/actions/data-actions.ts (修正)」、
 *       Flow 3 (data-actions の env 分岐)、Issue 2 (lazy lib/db loading)
 */

import { revalidateTag } from "next/cache";
import {
  resetMockDb,
  clearMockDb,
  restoreMockDb,
  snapshotMockDb,
  mockDb,
  type DbSnapshot,
} from "@/lib/mock/db";
import {
  SEED_STORES,
  SEED_DEALS,
  SEED_RESEARCH,
  SEED_HANDOFFS,
} from "@/lib/mock/seed";
import { repos } from "@/lib/repositories";
import { CACHE_TAGS } from "@/lib/cache";
import { failure, success, type ActionResult } from "./_helpers";

/** 起動時 env による Mock/DB 切替判定 (Req 5.1, 5.2)。 */
const isMockMode = () => process.env.USE_MOCK_DB === "true";

function invalidateAll() {
  for (const tag of [
    CACHE_TAGS.stores,
    CACHE_TAGS.research,
    CACHE_TAGS.deals,
    CACHE_TAGS.handoffs,
    CACHE_TAGS.stats,
    CACHE_TAGS.kpi,
    CACHE_TAGS.pipeline,
    CACHE_TAGS.actionQueue,
  ]) {
    revalidateTag(tag, "max");
  }
}

/**
 * Mock の Research / Handoff のみ SEED に戻す (DB モード時の部分リセット用)。
 * stores / deals は DB 側で別途リセットされるため、Mock の該当 Map は触らない。
 */
function resetMockResearchAndHandoffOnly(): void {
  mockDb.research.clear();
  for (const r of SEED_RESEARCH) {
    mockDb.research.set(r.id, { ...r });
  }
  mockDb.handoffs.clear();
  for (const h of SEED_HANDOFFS) {
    mockDb.handoffs.set(h.id, { ...h });
  }
}

/**
 * Mock の Research / Handoff のみクリア (DB モード時の部分クリア用)。
 */
function clearMockResearchAndHandoffOnly(): void {
  mockDb.research.clear();
  mockDb.handoffs.clear();
}

export async function resetToSeedAction(): Promise<ActionResult> {
  if (isMockMode()) {
    // Mock モード: 既存通り全エンティティを SEED に戻す (Req 8.5)
    resetMockDb();
  } else {
    // DB モード: stores / deals は DB をトランザクション内でリセット、
    // Research / Handoff は Mock 側のみ SEED に戻す (Req 8.3, 8.4)。
    // lib/db/* は DATABASE_URL 必須の副作用を持つため動的 import する (Issue 2)。
    try {
      const { db } = await import("@/lib/db/client");
      const { stores, deals } = await import("@/lib/db/schema");
      const { toDbRow: storeToDbRow } = await import(
        "@/lib/db/store-repository"
      );
      await db.transaction(async (tx) => {
        // FK (deals.store_id → stores.id) があるため deals → stores の順で削除
        await tx.delete(deals);
        await tx.delete(stores);

        // 親テーブル (stores) を先に upsert
        // ai_analysis_result はオブジェクト ↔ text 列の変換のため toDbRow 経由
        for (const s of SEED_STORES) {
          const row = storeToDbRow(s);
          await tx
            .insert(stores)
            .values(row)
            .onConflictDoUpdate({ target: stores.id, set: row });
        }
        // 子テーブル (deals) を後から upsert
        for (const d of SEED_DEALS) {
          await tx
            .insert(deals)
            .values(d)
            .onConflictDoUpdate({ target: deals.id, set: d });
        }
      });

      resetMockResearchAndHandoffOnly();
    } catch (e) {
      return failure(
        e instanceof Error
          ? `リセットに失敗しました: ${e.message}`
          : "リセットに失敗しました",
      );
    }
  }

  invalidateAll();
  return success(undefined, "シードデータにリセットしました");
}

export async function clearAllAction(): Promise<ActionResult> {
  if (isMockMode()) {
    // Mock モード: 既存通り全エンティティを空にする (Req 8.5)
    clearMockDb();
  } else {
    // DB モード: stores / deals は DB をトランザクション内で全削除、
    // Research / Handoff は Mock 側のみクリア (Req 8.4)。
    // lib/db/* は DATABASE_URL 必須の副作用を持つため動的 import する (Issue 2)。
    try {
      const { db } = await import("@/lib/db/client");
      const { stores, deals } = await import("@/lib/db/schema");
      await db.transaction(async (tx) => {
        // FK 整合のため deals → stores の順で削除
        await tx.delete(deals);
        await tx.delete(stores);
      });

      clearMockResearchAndHandoffOnly();
    } catch (e) {
      return failure(
        e instanceof Error
          ? `削除に失敗しました: ${e.message}`
          : "削除に失敗しました",
      );
    }
  }

  invalidateAll();
  return success(undefined, "全データを削除しました");
}

export async function importJsonAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return failure("ファイルを選択してください");
  }
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);

    const importedStores = Array.isArray(parsed?.stores)
      ? (parsed.stores as DbSnapshot["stores"])
      : undefined;
    const importedResearch = Array.isArray(parsed?.research)
      ? (parsed.research as DbSnapshot["research"])
      : undefined;
    const importedDeals = Array.isArray(parsed?.deals)
      ? (parsed.deals as DbSnapshot["deals"])
      : undefined;
    const importedHandoffs = Array.isArray(parsed?.handoffs)
      ? (parsed.handoffs as DbSnapshot["handoffs"])
      : undefined;

    if (isMockMode()) {
      // Mock モード: 既存通り全エンティティを Mock へ復元 (Req 8.5)
      restoreMockDb({
        stores: importedStores,
        research: importedResearch,
        deals: importedDeals,
        handoffs: importedHandoffs,
      });
    } else {
      // DB モード: stores / deals は DB へトランザクション内で upsert、
      // Research / Handoff は Mock 側のみ復元 (Req 8.2, 8.4)。
      // lib/db/* は DATABASE_URL 必須の副作用を持つため動的 import する (Issue 2)。
      if (importedStores || importedDeals) {
        const { db } = await import("@/lib/db/client");
        const { stores, deals } = await import("@/lib/db/schema");
        const { toDbRow: storeToDbRow } = await import(
          "@/lib/db/store-repository"
        );
        await db.transaction(async (tx) => {
          // 親 (stores) を先に upsert
          // ai_analysis_result はオブジェクト ↔ text 列の変換のため toDbRow 経由
          if (importedStores) {
            for (const s of importedStores) {
              const row = storeToDbRow(s);
              await tx
                .insert(stores)
                .values(row)
                .onConflictDoUpdate({ target: stores.id, set: row });
            }
          }
          // 子 (deals) を後に upsert
          if (importedDeals) {
            for (const d of importedDeals) {
              await tx
                .insert(deals)
                .values(d)
                .onConflictDoUpdate({ target: deals.id, set: d });
            }
          }
        });
      }

      // Mock 側は research / handoffs のみ復元 (stores / deals は触らない)
      restoreMockDb({
        research: importedResearch,
        handoffs: importedHandoffs,
      });
    }

    invalidateAll();
    return success(undefined, "インポートに成功しました");
  } catch (e) {
    return failure(
      e instanceof Error ? `JSON解析失敗: ${e.message}` : "インポートに失敗しました",
    );
  }
}

export async function getSnapshotForExportAction(): Promise<DbSnapshot> {
  if (isMockMode()) {
    // Mock モード: 既存通り全エンティティを Mock から取得 (Req 8.5)
    return snapshotMockDb();
  }

  // DB モード: stores / deals は DB から並列取得、Research / Handoff は Mock から
  // 取得して合成する (Req 8.1, 8.4)
  const [dbDeals, dbStores] = await Promise.all([
    repos.deal.list(),
    repos.store.list(),
  ]);
  const mockSnapshot = snapshotMockDb();

  return {
    stores: dbStores,
    research: mockSnapshot.research,
    deals: dbDeals,
    handoffs: mockSnapshot.handoffs,
  };
}
