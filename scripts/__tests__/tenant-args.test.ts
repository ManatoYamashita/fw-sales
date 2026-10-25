import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { parseTenantSelection } from "../_tenant-args.mjs";
import { createTenantSeed } from "@/lib/db/tenant-seed";
import { FIRSTWEB_TENANT_ID } from "@/lib/tenant/id";
import { SEED_STORES } from "@/lib/db/seed-data";
const A = "f3700000-0000-4000-8000-000000000001", B = "f3700000-0000-4000-8000-000000000002";
describe("明示テナントのCLI引数", () => {
  it.each([["--tenant=firstweb"], ["--tenant", "firstweb"]])("slugを受け付ける: %j", (...args) => { expect(parseTenantSelection(args)).toEqual({ kind: "tenant", value: "firstweb" }); });
  it.each([[`--tenant-id=${A}`], ["--tenant-id", A]])("UUIDを受け付ける: %j", (...args) => { expect(parseTenantSelection(args)).toEqual({ kind: "tenant-id", value: A }); });
  it.each([[], ["--tenant"], ["--tenant="], ["--tenant", "--apply"], ["--tenant-id=bad"], ["--tenant=../bad"], ["--tenant=a", "--tenant=b"], ["--tenant=a", `--tenant-id=${A}`]])("未指定・不正・重複を拒否: %j", (...args) => { expect(() => parseTenantSelection(args)).toThrow(); });
  it.each(["scripts/seed.ts", "scripts/backfill-basic-info.ts", "scripts/list-store-name-memos.ts", "scripts/set-profile-role.mjs", "scripts/diagnose-area-search-plan.mjs"])("%sは対象未指定ならDB初期化前に失敗する", (file) => {
    const args = file.endsWith(".ts") ? ["node_modules/tsx/dist/cli.mjs", file] : [file];
    const result = spawnSync(process.execPath, args, { env: { ...process.env, NODE_OPTIONS: "--conditions=react-server", DATABASE_URL: "postgres://not-a-real-database.invalid/db" }, encoding: "utf8", timeout: 5000 });
    expect(result.status).not.toBe(0); expect(result.stderr).toContain("--tenant");
    expect(result.stderr).not.toMatch(/ENOTFOUND|ECONNREFUSED|assertEnv|not-a-real-database/);
  });
});
describe("シードIDの所属namespace", () => {
  it("Firstwebの既存IDを維持し、A/Bには重複しないIDと正しい親参照を作る", () => {
    expect(createTenantSeed(FIRSTWEB_TENANT_ID).stores.map(s => s.id)).toEqual(SEED_STORES.map(s => s.id));
    const a = createTenantSeed(A), b = createTenantSeed(B);
    expect(new Set([...a.stores, ...b.stores].map(s => s.id)).size).toBe(a.stores.length + b.stores.length);
    expect(createTenantSeed(B.toUpperCase())).toEqual(b);
    for (const seed of [a, b]) {
      const stores = new Set(seed.stores.map(s => s.id)), deals = new Map(seed.deals.map(d => [d.id, d]));
      for (const d of seed.deals) expect(stores.has(d.store_id)).toBe(true);
      for (const h of seed.handoffs) { expect(stores.has(h.store_id)).toBe(true); expect(deals.get(h.deal_id)?.store_id).toBe(h.store_id); }
    }
  });
});
