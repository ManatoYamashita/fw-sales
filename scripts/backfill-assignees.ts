/**
 * 担当者カラム バックフィルスクリプト (auth-and-notifications spec, Issue #16)
 *
 * 役割:
 * - 既存 text カラム (`stores.assigned_planner` / `stores.assigned_sales` /
 *   `deals.assigned_sales`) の値を、`profiles` テーブルへの uuid 参照
 *   (`assigned_*_user_id` 系列) に変換する。
 * - `store_research_jobs.triggered_by` は #14 が text で導入した場合のみ追加対象。
 *   現状 #14 が未新設のため、本スクリプトは stores / deals のみを処理する。
 *
 * 実行モード:
 * - `--dry-run`: マッピング表を stdout に出力するのみ。UPDATE は発行しない。
 * - `--apply`  : マッピング表を出力した上で UPDATE を実行する。
 *
 * 実行例:
 *   pnpm tsx scripts/backfill-assignees.ts --dry-run
 *   pnpm tsx scripts/backfill-assignees.ts --apply
 *
 * マッピング戦略:
 * 1. 各カラムの distinct な text 値を取得
 * 2. `profiles.display_name` で完全一致 → 既存 profile id にマップ
 * 3. 不一致 → `placeholder profile`(`role='placeholder'`,
 *    `email='placeholder-{slug}@local.invalid'`)を新規生成しマップ
 *
 * 制約:
 * - `process.env.USE_MOCK_DB === "true"` の場合は警告して終了 (DB 経路専用)
 * - 全更新を 1 トランザクションで実行、途中失敗で ROLLBACK
 * - placeholder の `email` UNIQUE 衝突を避けるため、生成前に再 lookup する
 *
 * 関連: design.md §「Migration Strategy」/ §「scripts/backfill-assignees.ts」,
 *       requirements.md §3.4, §3.5, §5.1
 */

import { sql as drizzleSql } from "drizzle-orm";
import { db, sql } from "@/lib/db/client";
import { dbProfileRepo } from "@/lib/db/profile-repository";
import { stores, deals, profiles } from "@/lib/db/schema";

interface MappingEntry {
  readonly table: "stores" | "deals";
  readonly column: string;
  readonly oldValue: string;
  readonly newUserId: string;
  readonly resolvedBy: "match" | "placeholder";
}

/**
 * 表示名から placeholder の slug を生成する。
 * - 全角空白 / 半角空白を `-` に置換
 * - 英数字・ハイフン以外を `-` に置換
 * - 連続した `-` を 1 つに、両端の `-` を除去
 * - 全角文字も置換対象になるため、結果が空文字なら `unknown` フォールバック
 */
function slugify(name: string): string {
  const replaced = name
    .toLowerCase()
    .replace(/[\s　]+/g, "-")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return replaced === "" ? `unknown-${Date.now()}` : replaced;
}

/**
 * `name` に対応する profile.id を取得する。既存 member と一致しなければ
 * placeholder を新規生成する。同名 placeholder の重複を避けるため、generate 前に
 * 表示名で再 lookup する。
 */
async function resolveProfileId(
  name: string,
  cache: Map<string, { readonly id: string; readonly resolvedBy: "match" | "placeholder" }>,
): Promise<{ readonly id: string; readonly resolvedBy: "match" | "placeholder" }> {
  const cached = cache.get(name);
  if (cached) return cached;

  // 1. member プロフィールから完全一致を探す
  const exact = await dbProfileRepo.findByDisplayName(name);
  if (exact) {
    const result = { id: exact.id, resolvedBy: "match" as const };
    cache.set(name, result);
    return result;
  }

  // 2. placeholder を生成 (slug 衝突は cache で回避)
  const placeholder = await dbProfileRepo.createPlaceholder({
    displayName: name,
    slug: slugify(name),
  });
  const result = { id: placeholder.id, resolvedBy: "placeholder" as const };
  cache.set(name, result);
  return result;
}

function logMappingTable(entries: readonly MappingEntry[]): void {
  if (entries.length === 0) {
    console.log("(マッピング対象なし)");
    return;
  }
  console.log("table         | column                  | old text → new user_id (種別)");
  console.log("--------------+-------------------------+-----------------------------------------------");
  for (const e of entries) {
    const oldDisplay = e.oldValue === "" ? "(empty)" : e.oldValue;
    console.log(
      `${e.table.padEnd(13)} | ${e.column.padEnd(23)} | ${oldDisplay.padEnd(8)} → ${e.newUserId} (${e.resolvedBy})`,
    );
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const apply = args.includes("--apply");

  if (dryRun === apply) {
    console.error(
      "[backfill] --dry-run か --apply のいずれか 1 つを指定してください。",
    );
    process.exit(1);
  }

  if (process.env.USE_MOCK_DB === "true") {
    console.warn(
      "[backfill] USE_MOCK_DB=true ではバックフィル不要 (Mock seed が user_id を直接保持)。終了します。",
    );
    process.exit(0);
  }

  console.log(
    `[backfill] mode=${dryRun ? "dry-run" : "apply"} — 担当者カラムを user_id に変換します。`,
  );

  const profileCache = new Map<
    string,
    { readonly id: string; readonly resolvedBy: "match" | "placeholder" }
  >();
  const mappings: MappingEntry[] = [];

  // ======================================================================
  // 1. distinct な text 値を抽出 → profile.id にマップ
  // ======================================================================
  const distinctSets: { table: "stores" | "deals"; column: string; values: readonly string[] }[] = [];

  const storesPlannerRows = await db
    .select({ value: stores.assigned_planner })
    .from(stores)
    .groupBy(stores.assigned_planner);
  distinctSets.push({
    table: "stores",
    column: "assigned_planner",
    values: storesPlannerRows.map((r) => r.value).filter((v) => v !== ""),
  });

  const storesSalesRows = await db
    .select({ value: stores.assigned_sales })
    .from(stores)
    .groupBy(stores.assigned_sales);
  distinctSets.push({
    table: "stores",
    column: "assigned_sales",
    values: storesSalesRows.map((r) => r.value).filter((v) => v !== ""),
  });

  const dealsSalesRows = await db
    .select({ value: deals.assigned_sales })
    .from(deals)
    .groupBy(deals.assigned_sales);
  distinctSets.push({
    table: "deals",
    column: "assigned_sales",
    values: dealsSalesRows.map((r) => r.value).filter((v) => v !== ""),
  });

  // ======================================================================
  // 2. apply モードでは profile 解決時に DB 書込みが発生するため、
  //    dry-run はキャッシュのみで「何件 placeholder を作る予定か」を試算する
  // ======================================================================
  if (dryRun) {
    // dry-run: profile 解決を行うが DB 書込みは抑止する
    // findByDisplayName は読み取り専用、createPlaceholder は書込みなのでスキップ
    const dryCache = new Map<
      string,
      { readonly id: string; readonly resolvedBy: "match" | "placeholder" }
    >();
    for (const set of distinctSets) {
      for (const value of set.values) {
        if (dryCache.has(value)) continue;
        const exact = await dbProfileRepo.findByDisplayName(value);
        if (exact) {
          dryCache.set(value, { id: exact.id, resolvedBy: "match" });
        } else {
          dryCache.set(value, {
            id: `(would create placeholder for "${value}")`,
            resolvedBy: "placeholder",
          });
        }
      }
    }
    for (const set of distinctSets) {
      for (const value of set.values) {
        const resolved = dryCache.get(value);
        if (!resolved) continue;
        mappings.push({
          table: set.table,
          column: set.column,
          oldValue: value,
          newUserId: resolved.id,
          resolvedBy: resolved.resolvedBy,
        });
      }
    }
    console.log("\n[backfill] === dry-run マッピング表 ===");
    logMappingTable(mappings);
    const placeholders = mappings.filter((m) => m.resolvedBy === "placeholder");
    const matches = mappings.filter((m) => m.resolvedBy === "match");
    console.log(
      `\n[backfill] dry-run 完了: ${matches.length} 件は既存 member にマップ、${placeholders.length} 件は placeholder を新規作成予定。`,
    );
    await sql.end();
    return;
  }

  // ======================================================================
  // 3. apply: トランザクション内で profile 解決 + UPDATE を実行
  // ======================================================================
  await db.transaction(async () => {
    // distinct 値ごとに profile を解決 (placeholder 生成含む)
    for (const set of distinctSets) {
      for (const value of set.values) {
        if (profileCache.has(value)) continue;
        const resolved = await resolveProfileId(value, profileCache);
        // mapping への記録は UPDATE 対象とは別に保持
        mappings.push({
          table: set.table,
          column: set.column,
          oldValue: value,
          newUserId: resolved.id,
          resolvedBy: resolved.resolvedBy,
        });
      }
    }

    // UPDATE 文を発行
    for (const set of distinctSets) {
      for (const value of set.values) {
        const resolved = profileCache.get(value);
        if (!resolved) continue;
        if (set.table === "stores" && set.column === "assigned_planner") {
          await db
            .update(stores)
            .set({ assigned_planner_user_id: resolved.id })
            .where(drizzleSql`${stores.assigned_planner} = ${value}`);
        } else if (set.table === "stores" && set.column === "assigned_sales") {
          await db
            .update(stores)
            .set({ assigned_sales_user_id: resolved.id })
            .where(drizzleSql`${stores.assigned_sales} = ${value}`);
        } else if (set.table === "deals" && set.column === "assigned_sales") {
          await db
            .update(deals)
            .set({ assigned_sales_user_id: resolved.id })
            .where(drizzleSql`${deals.assigned_sales} = ${value}`);
        }
      }
    }
  });

  console.log("\n[backfill] === apply マッピング表 ===");
  logMappingTable(mappings);
  const placeholders = mappings.filter((m) => m.resolvedBy === "placeholder");
  const matches = mappings.filter((m) => m.resolvedBy === "match");
  console.log(
    `\n[backfill] apply 完了: ${matches.length} 件は既存 member にマップ、${placeholders.length} 件は placeholder を新規生成。`,
  );

  // 検証: 旧 text 値が NULL でない行のうち、新カラムが NULL のものをカウント
  const unmapped = await db
    .select({ count: drizzleSql<number>`count(*)::int` })
    .from(stores)
    .where(
      drizzleSql`${stores.assigned_planner} != '' AND ${stores.assigned_planner_user_id} IS NULL`,
    );
  const unmappedCount = unmapped[0]?.count ?? 0;
  if (unmappedCount > 0) {
    console.warn(
      `[backfill] WARNING: ${unmappedCount} 件の stores.assigned_planner が user_id にマップされていません。手動確認してください。`,
    );
  }

  // 全プロフィールリスト出力(運用での再利用)
  const allProfiles = await db.select().from(profiles);
  console.log(
    `\n[backfill] 現在の profiles 件数: ${allProfiles.length} 件 (うち placeholder: ${
      allProfiles.filter((p) => p.role === "placeholder").length
    } 件)`,
  );

  await sql.end();
}

main().catch(async (err) => {
  console.error("[backfill] Failed:", err);
  try {
    await sql.end({ timeout: 5 });
  } catch {
    // 既に終了している場合は無視
  }
  process.exit(1);
});
