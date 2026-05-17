/**
 * SEED 投入スクリプト
 *
 * 役割:
 * - `lib/db/seed-data.ts` の `SEED_STORES` / `SEED_DEALS` / `SEED_RESEARCH` /
 *   `SEED_HANDOFFS` の 4 entity を Postgres (Supabase) にベキ等な upsert で投入する。
 *
 * 実行例:
 * - `pnpm seed`
 *
 * 制約・設計判断:
 * - `lib/db/client.ts` および `lib/db/schema.ts` / `lib/db/store-repository.ts` を
 *   直接 import する。これは design.md の「Allowed Dependencies / Documented exception」
 *   に明記された `scripts/seed.ts` 限定の例外的措置である
 * - FK 整合性のため、親→子の順に upsert する:
 *   `stores → deals → research → handoffs`
 *   (handoffs.deal_id → deals, handoffs.store_id → stores, research.store_id → stores)
 * - `db.transaction(...)` で全件 upsert を 1 単位とし、途中失敗時は ROLLBACK
 * - スクリプト終了時は `sql.end()` で接続を明示クリーンアップする
 * - Research / Handoff は全フィールド primitive のため `toDbRow` 不要
 * - profiles テーブルの seed は本スクリプトの責務外。担当者紐付け
 *   (`assigned_*_user_id`) は seed-data.ts で全て null にしており、必要であれば
 *   別途 UPDATE する運用とする (Issue #39 USE_MOCK_DB 廃止に伴う方針)。
 */

import { db, sql } from "@/lib/db/client";
import { stores, deals, research, handoffs } from "@/lib/db/schema";
import { toDbRow as storeToDbRow } from "@/lib/db/store-repository";
import {
  SEED_STORES,
  SEED_DEALS,
  SEED_RESEARCH,
  SEED_HANDOFFS,
} from "@/lib/db/seed-data";

async function main(): Promise<void> {
  // 全 SEED 投入をトランザクションで包み、途中失敗時は ROLLBACK
  // 親→子の順 (stores → deals → research → handoffs) で FK 整合を保つ
  await db.transaction(async (tx) => {
    // 親テーブル (stores) を先に upsert
    // ai_analysis_result はオブジェクト ↔ text 列の変換のため toDbRow 経由
    for (const store of SEED_STORES) {
      const row = storeToDbRow(store);
      await tx
        .insert(stores)
        .values(row)
        .onConflictDoUpdate({
          target: stores.id,
          set: row,
        });
    }

    // 子テーブル (deals) は親 (stores) 投入後に upsert
    for (const deal of SEED_DEALS) {
      await tx
        .insert(deals)
        .values(deal)
        .onConflictDoUpdate({
          target: deals.id,
          set: deal,
        });
    }

    // research は stores の子 (research.store_id → stores)
    // 全フィールド primitive のため toDbRow 不要
    for (const r of SEED_RESEARCH) {
      await tx
        .insert(research)
        .values(r)
        .onConflictDoUpdate({
          target: research.id,
          set: r,
        });
    }

    // handoffs は stores と deals の両方の子 (handoffs.deal_id → deals, handoffs.store_id → stores)
    // 全フィールド primitive (payment_confirmed nullable text) のため toDbRow 不要
    for (const h of SEED_HANDOFFS) {
      await tx
        .insert(handoffs)
        .values(h)
        .onConflictDoUpdate({
          target: handoffs.id,
          set: h,
        });
    }
  });

  console.log(
    `Seeded ${SEED_STORES.length} stores, ${SEED_DEALS.length} deals, ${SEED_RESEARCH.length} research, ${SEED_HANDOFFS.length} handoffs.`,
  );

  // 接続を明示クリーンアップしてプロセスを終了させる
  await sql.end();
}

main().catch(async (err) => {
  console.error("[seed] Failed:", err);
  // エラーパスでも接続を片付けてからプロセスを落とす
  try {
    await sql.end({ timeout: 5 });
  } catch {
    // 既に終了している場合は無視
  }
  process.exit(1);
});
