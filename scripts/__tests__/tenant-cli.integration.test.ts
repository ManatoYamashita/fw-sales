/** 実際の運用CLIを2社のDB fixtureで動かす。検証用行だけfinallyで除去する。 */
import { describe, expect, it } from "vitest";
import postgres from "postgres";
import { spawn } from "node:child_process";
const A = "f3701000-0000-4000-8000-000000000001", B = "f3701000-0000-4000-8000-000000000002";
const U = "f3701000-0000-4000-8000-00000000000a";
function cli(file: string, args: string[]) {
  return new Promise<{ status: number | null; output: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [...(file.endsWith(".ts") ? ["node_modules/tsx/dist/cli.mjs"] : []), file, ...args], { env: { ...process.env, NODE_OPTIONS: "--conditions=react-server" }, stdio: ["ignore", "pipe", "pipe"] });
    let output = ""; child.stdout.on("data", b => { output += b; }); child.stderr.on("data", b => { output += b; });
    const timer = setTimeout(() => { child.kill(); reject(new Error("CLI timed out")); }, 15000);
    child.on("error", e => { clearTimeout(timer); reject(e); }); child.on("close", status => { clearTimeout(timer); resolve({ status, output }); });
  });
}
describe("テナント指定CLIの実DB検証", () => {
  it("seed/ロール/名称一覧/backfillはBだけを扱い、不明な所属では失敗する", async () => {
    expect(process.env.DATABASE_URL).toBeTruthy();
    const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });
    try {
      for (const [id, slug] of [[A,"cli-370-a"],[B,"cli-370-b"]] as const) await sql`insert into tenants(id,slug,name,created_at,updated_at) values (${id},${slug},${slug},'2026-10-24','2026-10-24')`;
      await sql`insert into auth.users(id,email,raw_user_meta_data) values (${U},'cli-370@example.test','{}')`;
      for (const tenant of [A,B]) await sql`insert into memberships(tenant_id,user_id,role,created_at,updated_at) values (${tenant},${U},'member','2026-10-24','2026-10-24')`;
      expect((await cli("scripts/seed.ts", ["--tenant=cli-370-a"])).status).toBe(0);
      const before = await sql`select * from stores where tenant_id=${A} order by id`;
      expect((await cli("scripts/seed.ts", ["--tenant=cli-370-b"])).status).toBe(0);
      expect((await cli("scripts/seed.ts", [`--tenant-id=${B}`])).status).toBe(0);
      expect(await sql`select * from stores where tenant_id=${A} order by id`).toEqual(before);
      expect((await sql`select count(*)::int as n from stores where tenant_id=${B}`)[0]?.n).toBe(5);
      expect((await cli("scripts/set-profile-role.mjs", ["--tenant=cli-370-b", "--email=cli-370@example.test", "--role=admin"])).status).toBe(0);
      expect(await sql`select tenant_id,role from memberships where user_id=${U} and tenant_id in (${A},${B}) order by tenant_id`).toEqual([{tenant_id:A,role:"member"},{tenant_id:B,role:"admin"}]);
      await sql`update stores set name='（Rアポ）SECRET A SHOP' where tenant_id=${A}`;
      await sql`update stores set name='（Rアポ）PUBLIC B SHOP' where tenant_id=${B}`;
      const listing = await cli("scripts/list-store-name-memos.ts", ["--tenant=cli-370-b"]);
      expect(listing.status).toBe(0); expect(listing.output).toContain("PUBLIC B SHOP"); expect(listing.output).not.toContain("SECRET A SHOP");
      const beforeBackfill = await sql`select * from stores where tenant_id=${A} order by id`;
      const backfill = await cli("scripts/backfill-basic-info.ts", ["--tenant=cli-370-b", "--apply"]);
      expect(backfill.status).toBe(0); expect(backfill.output).not.toContain("SECRET A SHOP");
      expect(await sql`select * from stores where tenant_id=${A} order by id`).toEqual(beforeBackfill);
      expect((await sql`select count(*)::int as n from stores where tenant_id=${B} and basic_info <> '{}'::jsonb`)[0]?.n).toBe(5);
      expect((await cli("scripts/seed.ts", ["--tenant=cli-370-missing"])).status).not.toBe(0);
    } finally {
      await sql`delete from handoffs where tenant_id in (${A},${B})`;
      await sql`delete from deals where tenant_id in (${A},${B})`;
      await sql`delete from stores where tenant_id in (${A},${B})`;
      await sql`delete from auth.users where id=${U}`;
      await sql`delete from tenants where id in (${A},${B})`;
      await sql.end();
    }
  }, 60000);
});
