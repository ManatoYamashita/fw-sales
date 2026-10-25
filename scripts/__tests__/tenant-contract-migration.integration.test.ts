/** #371: 実際のmigration SQLをexpand状態へ適用し、互換性と失敗時の復元を確認する。 */
import { afterAll, beforeAll, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import type { Tx } from "@/lib/db/client";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { readFileSync } from "node:fs";
import * as schema from "@/lib/db/schema";
import { SEED_STORES, SEED_DEALS } from "@/lib/db/seed-data";
import { toDbRow } from "@/lib/db/store-repository";
import { makeAppSettingsRepo } from "@/lib/db/app-settings-repository";

const name = `issue371_migration_${process.pid}`;
const A="f3713000-0000-4000-8000-000000000001", B="f3713000-0000-4000-8000-000000000002";
let admin: postgres.Sql, connection: postgres.Sql;
const contract = readFileSync("drizzle/0034_tenant_constraints_contract.sql","utf8");

beforeAll(async () => {
  // CREATE/DROP DATABASEは専用ローカル検証サーバーだけで許可する。
  expect(process.env.APP_ENV).toBe("local");
  const url = new URL(process.env.DATABASE_URL!);
  expect(url.hostname).toMatch(/^(localhost|127\.0\.0\.1|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/);
  admin=postgres(url.href,{prepare:false,max:1});
  await admin.unsafe(`CREATE DATABASE "${name}"`);
  url.pathname=`/${name}`; connection=postgres(url.href,{prepare:false,max:1});
  await connection.unsafe("CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb)");
  const journal=JSON.parse(readFileSync("drizzle/meta/_journal.json","utf8"));
  const end=journal.entries.findIndex((e:{tag:string})=>e.tag==="0034_tenant_constraints_contract");
  expect(end).toBeGreaterThan(0);
  const migrations=readMigrationFiles({migrationsFolder:"drizzle"});
  await connection.begin(async tx=>{
    for(const migration of migrations.slice(0,end)) for(const statement of migration.sql) await tx.unsafe(statement);
  });
},30000);
afterAll(async()=>{
  await connection?.end({timeout:5});
  if(admin) { await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`); await admin.end({timeout:5}); }
});

async function withExpansion(work:(tx:Tx)=>Promise<void>) {
  const rollback=new Error("rollback migration fixture");
  await expect(drizzle(connection,{schema}).transaction(async tx=>{
    const db=tx;
    await db.insert(schema.tenants).values([A,B].map((id,i)=>({id,slug:`migration-${i}`,name:id,created_at:"2026-10-25",updated_at:"2026-10-25"})));
    await db.insert(schema.stores).values({...toDbRow(SEED_STORES[0]!),id:"migration-store-a",tenant_id:A});
    await work(tx); throw rollback;
  })).rejects.toBe(rollback);
}

it("expandは旧コードと新コードを受理し、contract後も同じ複合upsertで設定を保持する",async()=>withExpansion(async tx=>{
  await tx.execute(sql`INSERT INTO app_settings(key,value,updated_at) VALUES('legacy','old','2026-10-25')
    ON CONFLICT(key) DO UPDATE SET value=excluded.value`);
  const db=tx, a=makeAppSettingsRepo(db,A),b=makeAppSettingsRepo(db,B);
  await a.set("shared","A");
  await tx.execute(sql.raw(contract));
  await a.set("shared","A updated"); await b.set("shared","B");
  expect(await a.get("shared")).toBe("A updated");expect(await b.get("shared")).toBe("B");
  expect(await tx.execute(sql`SELECT value FROM app_settings WHERE key='legacy'`)).toEqual([{value:"old"}]);
}));

it("旧越境参照があればcontract全体を戻し、DEFAULT・旧PK・行を変更しない",async()=>withExpansion(async tx=>{
  const db=tx;
  await db.insert(schema.deals).values({...SEED_DEALS[0]!,id:"legacy-cross-tenant",tenant_id:B,store_id:"migration-store-a"});
  const before=await tx.execute(sql`SELECT * FROM deals ORDER BY id`);
  await expect(tx.transaction(sp=>sp.execute(sql.raw(contract)))).rejects.toMatchObject({cause:{code:"23503"}});
  expect(await tx.execute(sql`SELECT * FROM deals ORDER BY id`)).toEqual(before);
  const counts=await tx.execute(sql`SELECT count(*)::int AS n FROM information_schema.columns
    WHERE table_schema='public' AND column_name='tenant_id' AND column_default IS NOT NULL`);
  expect(counts[0]?.n).toBe(9);
  expect(await tx.execute(sql`SELECT conname FROM pg_constraint WHERE conrelid='app_settings'::regclass AND contype='p'`)).toEqual([{conname:"app_settings_pkey"}]);
  expect(await tx.execute(sql`SELECT conname FROM pg_constraint WHERE conname='deals_tenant_store_fk'`)).toHaveLength(0);
}));

it("contractは越境参照をDBで拒否し、候補のSET NULLで所属を消さない",async()=>withExpansion(async tx=>{
  await tx.execute(sql.raw(contract));
  const db=tx;
  await expect(tx.transaction(async sp=>{
    await sp.insert(schema.deals).values({...SEED_DEALS[0]!,id:"blocked",tenant_id:B,store_id:"migration-store-a"});
  })).rejects.toMatchObject({cause:{code:"23503"}});
  await db.insert(schema.placeCandidates).values({id:"candidate",tenant_id:A,google_place_id:"shared",matched_store_id:"migration-store-a",first_seen_at:"2026-10-25",last_seen_at:"2026-10-25",created_at:"2026-10-25",updated_at:"2026-10-25"});
  await tx.execute(sql`DELETE FROM stores WHERE id='migration-store-a'`);
  expect(await tx.execute(sql`SELECT tenant_id,matched_store_id FROM place_candidates`)).toEqual([{tenant_id:A,matched_store_id:null}]);
}));
