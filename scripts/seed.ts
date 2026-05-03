/**
 * SEED 投入スクリプト
 *
 * 役割:
 * - `lib/mock/seed.ts` の `SEED_STORES` / `SEED_DEALS` を Postgres (Supabase) に
 *   ベキ等な upsert で投入する。Mock と DB の双方で同一データを再現する目的。
 *   (requirements.md §7.1, §7.2)
 *
 * 実行例:
 * - `pnpm tsx scripts/seed.ts`
 *
 * 制約・設計判断:
 * - `process.env.USE_MOCK_DB === "true"` の場合は誤実行防止のため警告のみで終了する
 *   (requirements.md §7.3)
 * - `lib/db/client.ts` および `lib/db/schema.ts` を直接 import する。これは
 *   design.md の「Allowed Dependencies / Documented exception」に明記された
 *   `scripts/seed.ts` 限定の例外的措置である
 * - FK 整合性のため `stores` を先に upsert し、`deals` を後から投入する
 * - `db.transaction(...)` で全件 upsert を 1 単位とし、途中失敗時は ROLLBACK
 * - スクリプト終了時は `sql.end()` で接続を明示クリーンアップする
 *
 * 関連: requirements.md §7、design.md §「`scripts/seed.ts`」
 */

import { db, sql } from "@/lib/db/client";
import { stores, deals } from "@/lib/db/schema";
import { SEED_STORES, SEED_DEALS } from "@/lib/mock/seed";

async function main(): Promise<void> {
  // Mock モードでの誤実行を防止 (requirements.md §7.3)
  if (process.env.USE_MOCK_DB === "true") {
    console.warn(
      "[seed] USE_MOCK_DB=true detected — DB seed をスキップします。Mock モードでは本スクリプトは不要です。",
    );
    process.exit(0);
  }

  // 全 SEED 投入をトランザクションで包み、途中失敗時は ROLLBACK
  await db.transaction(async (tx) => {
    // 親テーブル (stores) を先に upsert
    for (const store of SEED_STORES) {
      await tx
        .insert(stores)
        .values(store)
        .onConflictDoUpdate({
          target: stores.id,
          set: store,
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
  });

  console.log(
    `Seeded ${SEED_STORES.length} stores, ${SEED_DEALS.length} deals.`,
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
