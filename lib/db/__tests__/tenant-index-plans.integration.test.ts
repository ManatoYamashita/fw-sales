/** #371: 2社・1万行で主要な索引の実行計画を確認する。所要時間の閾値には依存しない。 */
import { expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema";
import { SEED_STORES } from "@/lib/db/seed-data";
import { toDbRow } from "@/lib/db/store-repository";

it("所属付き一覧・Place ID検索・bbox/OR検索に複合索引が使われる", async () => {
  const rollback = new Error("rollback index fixture");
  await expect(db.transaction(async tx => {
    const ids = ["f3712000-0000-4000-8000-000000000001", "f3712000-0000-4000-8000-000000000002"];
    for (const [i,tenant] of ids.entries()) {
      await tx.insert(tenants).values({ id:tenant,slug:`index-371-${i}`,name:tenant,created_at:"2026-10-25",updated_at:"2026-10-25" });
      const base = JSON.stringify({ ...toDbRow(SEED_STORES[0]!),tenant_id:tenant });
      await tx.execute(sql`INSERT INTO stores SELECT (jsonb_populate_record(NULL::stores, ${base}::jsonb ||
        jsonb_build_object('id',${`index-${i}-`} || n,'google_place_id',${`place-${i}-`} || n,
          'lat',35.0+(n%100)*0.001,'lng',139.0+(n%70)*0.001))).*
        FROM generate_series(1,5000) n`);
    }
    await tx.execute(sql`ANALYZE stores`);
    // Supabaseの実測と同じplanner設定。seqscanの強制無効化は行わない。
    await tx.execute(sql`SET LOCAL random_page_cost = 1.1`);
    const tenant = ids[1]!;
    const queries = [
      ["list",sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT * FROM stores WHERE tenant_id=${tenant} ORDER BY created_at DESC LIMIT 50`,"stores_tenant_created_idx"],
      ["place",sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT * FROM stores WHERE tenant_id=${tenant} AND google_place_id IN ('place-1-1','place-1-2')`,"stores_tenant_google_place_idx"],
      ["bbox",sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT * FROM stores WHERE tenant_id=${tenant} AND lat BETWEEN 35.01 AND 35.011 AND lng BETWEEN 139.01 AND 139.02 ORDER BY created_at DESC`,"stores_tenant_lat_lng_idx"],
      ["or",sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT * FROM stores WHERE tenant_id=${tenant} AND (google_place_id IN ('place-1-1','place-1-2') OR (lat BETWEEN 35.01 AND 35.011 AND lng BETWEEN 139.01 AND 139.02)) ORDER BY created_at DESC`,"stores_tenant_lat_lng_idx"],
    ] as const;
    for (const [name,query,index] of queries) {
      const plan = await tx.execute(query), text = JSON.stringify(plan);
      console.info(`[tenant-index:${name}] ${text}`);
      expect(text,name).toContain(index); expect(text,name).toContain("Index Cond"); expect(text,name).toContain("tenant_id");
    }
    throw rollback;
  })).rejects.toBe(rollback);
},30000);
