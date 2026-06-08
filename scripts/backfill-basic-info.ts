/**
 * 既存店舗スカラー列から `basic_info`(jsonb)への backfill スクリプト
 * (store-basic-info / task 3.4, PR1 expand)
 *
 * 役割:
 * - 既存 `stores` の調査系スカラー列 (name, prefecture, city, address, genre,
 *   business_hours, site_url, instagram_url) を `BASIC_INFO_ITEMS` の対応キーへ射影し、
 *   `mergeBasicInfo(..., "manual")` 経由で永続化する。
 * - 取得ソースは `"manual"` (既存スカラーは手動編集された可能性が高く、以後の Places
 *   自動充填で破壊されないよう保護する、R8.2 連続性)。
 * - 調査結果テーブル (`research_reports`) は参照しない (#121, design L398)。
 *
 * 実行モード (2 段):
 * - `--dry-run` (既定): 対象件数と変換内容のサマリを出力、DB は変更しない
 * - `--apply`: 実際に mergeBasicInfo を実行 (本番直結 DB のため CI 経由を推奨)
 *
 * 防衛条件:
 * - 既に `basic_info` に 1 キー以上充足されている店舗は skip
 *   (既存編集を上書きしない、手動 backfill 再実行に対する idempotency)
 *
 * 実行例:
 * - `pnpm db:backfill-basic-info`         # dry-run
 * - `pnpm db:backfill-basic-info --apply` # 適用
 *
 * 制約 (seed.ts 同様):
 * - `lib/db/*` を直接 import (design Allowed Dependencies / Documented exception)
 * - 終了時に `sql.end()` で接続クリーンアップ
 *
 * 関連: requirements.md §8.1 §8.2 §8.3, design.md §Migration Strategy PR1
 */

import { db, sql } from "@/lib/db/client";
import { dbStoreRepo } from "@/lib/db/store-repository";
import { stores as storesTable } from "@/lib/db/schema";
import type { Store } from "@/types/store";
import { scalarToBasicInfo } from "./_basic-info-mapping";

// 射影純関数は `_basic-info-mapping.ts` に分離 (vitest 副作用 import 回避)。
// 本ファイル top-level の `db`/`sql` import が test 環境で接続初期化を起こすため、
// 純関数のみ独立 import 可能な別モジュールに切り出している。

interface BackfillStats {
  total: number;
  alreadyFilled: number;
  noScalarData: number;
  willMerge: number;
  applied: number;
  errors: number;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const dryRun = !apply;
  const mode = dryRun ? "[DRY-RUN]" : "[APPLY]";

  console.log(`${mode} backfill-basic-info: 開始`);

  const all: Store[] = await dbStoreRepo.list();
  const stats: BackfillStats = {
    total: all.length,
    alreadyFilled: 0,
    noScalarData: 0,
    willMerge: 0,
    applied: 0,
    errors: 0,
  };

  for (const store of all) {
    // 既存 basic_info に 1 キー以上あれば skip (idempotency)
    if (store.basic_info && Object.keys(store.basic_info).length > 0) {
      stats.alreadyFilled += 1;
      continue;
    }

    const now = new Date().toISOString();
    const partial = scalarToBasicInfo(store, now);
    if (Object.keys(partial).length === 0) {
      stats.noScalarData += 1;
      continue;
    }

    stats.willMerge += 1;
    const partialKeys = Object.keys(partial).join(", ");
    console.log(
      `${mode} ${store.id} (${store.name}): ${Object.keys(partial).length} 項目 → ${partialKeys}`,
    );

    if (apply) {
      try {
        await dbStoreRepo.mergeBasicInfo(store.id, partial, "manual");
        stats.applied += 1;
      } catch (err) {
        stats.errors += 1;
        console.error(
          `${mode} ${store.id}: mergeBasicInfo 失敗`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  console.log("---");
  console.log(`${mode} 結果サマリ:`);
  console.log(`  全店舗数:              ${stats.total}`);
  console.log(`  既に basic_info あり:  ${stats.alreadyFilled} (skip)`);
  console.log(`  スカラー値なし:        ${stats.noScalarData} (skip)`);
  console.log(`  backfill 対象:         ${stats.willMerge}`);
  if (apply) {
    console.log(`  適用成功:              ${stats.applied}`);
    console.log(`  エラー:                ${stats.errors}`);
  } else {
    console.log("  → DB は変更していません。--apply で実行してください。");
  }

  // ESM 環境で `db` の保留接続を確実に閉じる (seed.ts 同様)。
  void db; // 副作用 import の suppress
  await sql.end();
  void storesTable; // table reference を tree-shaking から守る (lint 抑止用)
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("backfill-basic-info: 異常終了", err);
    sql.end().finally(() => process.exit(1));
  });
