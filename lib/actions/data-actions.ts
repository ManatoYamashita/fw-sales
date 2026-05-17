"use server";

/**
 * データ移送 Server Actions (Reset / Clear / Import / Export Snapshot)
 *
 * 役割:
 * - Settings 画面から呼ばれる Reset / Clear / Import / Export のエントリ。
 *   `stores` / `deals` / `research` / `handoffs` の 4 entity 全てを DB へ直接適用する
 *   (Req 8.1〜8.5、research-handoff-db-migration §8)。
 *
 * 制約 / 例外:
 * - 本ファイルは design.md の "Allowed Dependencies / Documented exception" に
 *   従い、`lib/db/client.ts` (`db`) と `lib/db/schema.ts` (4 entity 全テーブル) を
 *   参照する。これは TRUNCATE / BULK UPSERT 等 Repository interface で
 *   表現できない DDL 級操作を扱うための data-actions.ts と scripts/seed.ts
 *   限定の例外であり、他ファイルでは追加してはならない。
 * - `lib/db/*` は **動的 import** で評価する。Next.js のバンドル解析性のため
 *   必ず文字列リテラルで記述すること (Issue 2 の既存パターンを踏襲)。
 * - 既存の Server Action シグネチャ (`resetToSeedAction()` /
 *   `clearAllAction()` / `importJsonAction(_prev, formData)` /
 *   `getSnapshotForExportAction()`) と戻り値型は無修正で維持する (Req 9.1)。
 * - `next/cache` の `revalidateTag(_, "max")` 失効規約も従前の通り。
 *
 * 関連: requirements.md §8.1–8.6、design.md §「lib/actions/data-actions.ts (修正)」、
 *       research-handoff-db-migration design Flow 4
 */

import { revalidateTag } from "next/cache";
import {
  SEED_STORES,
  SEED_DEALS,
  SEED_RESEARCH,
  SEED_HANDOFFS,
} from "@/lib/db/seed-data";
import type { DbSnapshot } from "@/lib/db/snapshot";
import { repos } from "@/lib/repositories";
import { CACHE_TAGS } from "@/lib/cache";
import { failure, success, type ActionResult } from "./_helpers";

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

export async function resetToSeedAction(): Promise<ActionResult> {
  // 4 entity 全てを DB トランザクション内でリセット
  // (research-handoff-db-migration §8.3, §8.4, §8.5)。
  // lib/db/* は DATABASE_URL 必須の副作用を持つため動的 import する (Issue 2)。
  try {
    const { db } = await import("@/lib/db/client");
    const { stores, deals, research, handoffs } = await import(
      "@/lib/db/schema"
    );
    const { toDbRow: storeToDbRow } = await import(
      "@/lib/db/store-repository"
    );
    await db.transaction(async (tx) => {
      // FK 整合のため子→親の順で削除
      // (handoffs.deal_id → deals, handoffs.store_id → stores,
      //  research.store_id → stores, deals.store_id → stores)
      await tx.delete(handoffs);
      await tx.delete(research);
      await tx.delete(deals);
      await tx.delete(stores);

      // 親→子の順で upsert
      // ai_analysis_result はオブジェクト ↔ text 列の変換のため toDbRow 経由
      for (const s of SEED_STORES) {
        const row = storeToDbRow(s);
        await tx
          .insert(stores)
          .values(row)
          .onConflictDoUpdate({ target: stores.id, set: row });
      }
      for (const d of SEED_DEALS) {
        await tx
          .insert(deals)
          .values(d)
          .onConflictDoUpdate({ target: deals.id, set: d });
      }
      // Research / Handoff は primitive のみで toDbRow 不要
      for (const r of SEED_RESEARCH) {
        await tx
          .insert(research)
          .values(r)
          .onConflictDoUpdate({ target: research.id, set: r });
      }
      for (const h of SEED_HANDOFFS) {
        await tx
          .insert(handoffs)
          .values(h)
          .onConflictDoUpdate({ target: handoffs.id, set: h });
      }
    });
  } catch (e) {
    return failure(
      e instanceof Error
        ? `リセットに失敗しました: ${e.message}`
        : "リセットに失敗しました",
    );
  }

  invalidateAll();
  return success(undefined, "シードデータにリセットしました");
}

export async function clearAllAction(): Promise<ActionResult> {
  // 4 entity 全てを DB トランザクション内で全削除
  // (research-handoff-db-migration §8.4, §8.5)。
  // lib/db/* は DATABASE_URL 必須の副作用を持つため動的 import する (Issue 2)。
  try {
    const { db } = await import("@/lib/db/client");
    const { stores, deals, research, handoffs } = await import(
      "@/lib/db/schema"
    );
    await db.transaction(async (tx) => {
      // FK 整合のため子→親の順で削除
      await tx.delete(handoffs);
      await tx.delete(research);
      await tx.delete(deals);
      await tx.delete(stores);
    });
  } catch (e) {
    return failure(
      e instanceof Error
        ? `削除に失敗しました: ${e.message}`
        : "削除に失敗しました",
    );
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

    // 4 entity 全てを DB へトランザクション内で upsert
    // (research-handoff-db-migration §8.2, §8.4, §8.5)。
    // lib/db/* は DATABASE_URL 必須の副作用を持つため動的 import する (Issue 2)。
    if (
      importedStores ||
      importedDeals ||
      importedResearch ||
      importedHandoffs
    ) {
      const { db } = await import("@/lib/db/client");
      const { stores, deals, research, handoffs } = await import(
        "@/lib/db/schema"
      );
      const { toDbRow: storeToDbRow } = await import(
        "@/lib/db/store-repository"
      );
      await db.transaction(async (tx) => {
        // 親 → 子の順で upsert (FK 整合)
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
        if (importedDeals) {
          for (const d of importedDeals) {
            await tx
              .insert(deals)
              .values(d)
              .onConflictDoUpdate({ target: deals.id, set: d });
          }
        }
        // Research / Handoff は primitive のみで toDbRow 不要
        if (importedResearch) {
          for (const r of importedResearch) {
            await tx
              .insert(research)
              .values(r)
              .onConflictDoUpdate({ target: research.id, set: r });
          }
        }
        if (importedHandoffs) {
          for (const h of importedHandoffs) {
            await tx
              .insert(handoffs)
              .values(h)
              .onConflictDoUpdate({ target: handoffs.id, set: h });
          }
        }
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
  // 4 entity を DB から並列取得 (Req 8.1, 8.4)。
  const [dbDeals, dbStores, dbResearch, dbHandoffs] = await Promise.all([
    repos.deal.list(),
    repos.store.list(),
    repos.research.list(),
    repos.handoff.list(),
  ]);

  return {
    stores: dbStores,
    research: dbResearch,
    deals: dbDeals,
    handoffs: dbHandoffs,
  };
}
