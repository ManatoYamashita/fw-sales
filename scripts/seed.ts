/** 指定テナントだけに冪等seedを投入する。例: pnpm seed --tenant=firstweb (#370)。 */
import { parseTenantSelection, resolveScriptTenant } from "./_tenant-args.mjs";
import { createTenantSeed } from "@/lib/db/tenant-seed";

async function main() {
  // 不足・重複・不正な指定ではDBクライアントを初期化しない。
  const selection = parseTenantSelection(process.argv.slice(2));
  const { db, sql } = await import("@/lib/db/client");
  try {
    const tenant = await resolveScriptTenant(sql, selection);
    const { makeDataRepo } = await import("@/lib/db/data-repository");
    const snapshot = createTenantSeed(tenant.id);
    await makeDataRepo(db, tenant.id).importSnapshot(snapshot);
    console.log(`Seeded tenant=${tenant.slug}: ${snapshot.stores.length} stores, ${snapshot.deals.length} deals, ${snapshot.handoffs.length} handoffs.`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
main().catch(error => { console.error("[seed] Failed:", error instanceof Error ? error.message : "seed failed"); process.exitCode = 1; });
