/**
 * 店舗詳細のインライン編集 (`updateStorePatchAction`) が、許可した列だけを更新することを
 * 実 PostgreSQL で確かめる (#384 のレビュー)。
 *
 * repository の `update` は渡されたキーをそのまま SET する。最初のテストでそれを示したうえで、
 * action を通すと `tenant_id` などを含む patch は何も書かず、各画面の patch は許可した列だけを
 * 書くことを確かめる。
 *
 * 他の結合テストと DB を共有するため、各テストはトランザクション内で行い、最後に ROLLBACK する。
 * action が使う repository は、そのトランザクションに束ねたものへ差し替える。
 */
import { describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

import type { StoreInput } from "@/types/store";

const PROFILE_ID = "00000000-0000-4000-8000-000000003840";
const OTHER_TENANT_ID = "00000000-0000-4000-8000-0000000038ff";

const holder = vi.hoisted(() => ({ tx: null as unknown }));

vi.mock("@/lib/repositories", async () => {
  const { makeStoreRepo } = await import("@/lib/db/store-repository");
  const { makeProfileRepo } = await import("@/lib/db/profile-repository");
  const bound = () => {
    if (!holder.tx) throw new Error("テスト用のトランザクションの中で呼ぶ");
    return holder.tx as never;
  };
  return {
    repos: {
      store: { update: (id: string, patch: never) => makeStoreRepo(bound()).update(id, patch) },
      profile: { findById: (id: string) => makeProfileRepo(bound()).findById(id) },
    },
  };
});
vi.mock("@/lib/supabase/server", () => ({ getCurrentProfile: async () => ({ id: PROFILE_ID }) }));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn(), updateTag: vi.fn() }));

const { db } = await import("@/lib/db/client");
const { makeStoreRepo } = await import("@/lib/db/store-repository");
const { SEED_STORES } = await import("@/lib/db/seed-data");
const { updateStorePatchAction } = await import("@/lib/actions/store-actions");

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const SEED_INPUT: StoreInput = { ...SEED_STORES[0]! };

async function inRolledBackTransaction(work: (tx: Tx) => Promise<void>): Promise<void> {
  const rollback = new Error("rollback");
  await expect(
    db.transaction(async (tx) => {
      holder.tx = tx;
      try {
        await work(tx);
      } finally {
        holder.tx = null;
      }
      throw rollback;
    }),
  ).rejects.toBe(rollback);
}

/** 編集対象外の列と、編集対象の列のいくつかを読む。 */
async function readRow(tx: Tx, id: string): Promise<Record<string, unknown>> {
  const rows = (await tx.execute(sql`
    SELECT id, tenant_id, created_at, stage, memo, basic_info, genre, phone, lat, contact_email,
           assigned_sales_user_id
    FROM stores WHERE id = ${id}`)) as unknown as Array<Record<string, unknown>>;
  return rows[0]!;
}

async function setUp(tx: Tx): Promise<string> {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  await tx.execute(sql`
    INSERT INTO tenants (id, slug, name, created_at, updated_at)
    VALUES (${OTHER_TENANT_ID}, 'other-384', '別テナント', '2026-10-21', '2026-10-21')`);
  // profiles.id は auth.users を参照する (CI と同じ auth.users の代わりの表に入れる)
  await tx.execute(sql`
    INSERT INTO auth.users (id, email, raw_user_meta_data)
    VALUES (${PROFILE_ID}, 'sales-384@example.test', '{}'::jsonb)`);
  await tx.execute(sql`
    INSERT INTO profiles (id, email, display_name, created_at, updated_at)
    VALUES (${PROFILE_ID}, 'sales-384@example.test', '営業384', '2026-10-21', '2026-10-21')
    ON CONFLICT (id) DO NOTHING`);
  const created = await makeStoreRepo(tx).create({ ...SEED_INPUT, memo: "元のメモ", genre: "元の業態" });
  return created.id;
}

describe("updateStorePatchAction の許可リスト (実 DB)", () => {
  it("repository の update だけでは tenant_id も書き換わる (action で絞る理由)", async () => {
    await inRolledBackTransaction(async (tx) => {
      const id = await setUp(tx);
      await makeStoreRepo(tx).update(id, { tenant_id: OTHER_TENANT_ID } as never);
      expect((await readRow(tx, id)).tenant_id).toBe(OTHER_TENANT_ID);
    });
  });

  it("tenant_id・id・作成日時・段階・基本情報を含む patch は、ほかの項目も含めて何も書かない", async () => {
    await inRolledBackTransaction(async (tx) => {
      const id = await setUp(tx);
      const before = await readRow(tx, id);
      for (const extra of [
        { tenant_id: OTHER_TENANT_ID },
        { id: "store_hijacked_384" },
        { created_at: "2000-01-01" },
        { stage: "受注" },
        { memo: "書き換え" },
        { basic_info: { phone: { value: "x" } } },
      ]) {
        const result = await updateStorePatchAction(id, { genre: "書き換え", ...extra } as never);
        expect(result.ok).toBe(false);
      }
      expect(await readRow(tx, id)).toEqual(before);
    });
  });

  it("不正な値を 1 つでも含む patch は、何も書かない", async () => {
    await inRolledBackTransaction(async (tx) => {
      const id = await setUp(tx);
      const before = await readRow(tx, id);
      for (const patch of [
        { genre: "書き換え", lat: 999 },
        { genre: "書き換え", channel: "定義外" },
        { genre: "書き換え", contact_email: "bad@@example.com" },
        { genre: "書き換え", assigned_sales_user_id: "00000000-0000-4000-8000-0000000000aa" },
      ]) {
        expect((await updateStorePatchAction(id, patch as never)).ok).toBe(false);
      }
      expect(await readRow(tx, id)).toEqual(before);
    });
  });

  it("各画面の patch は、許可した列だけを書く", async () => {
    await inRolledBackTransaction(async (tx) => {
      const id = await setUp(tx);
      const before = await readRow(tx, id);
      for (const patch of [
        { name: "導楽 本店", genre: "居酒屋" },
        { prefecture: "東京都", channel: "DM推奨", contact_email: " a@example.com ", assigned_sales_user_id: PROFILE_ID, assigned_planner_user_id: "" },
        { lat: 35.64, lng: 139.69 },
        { map_url: "", site_url: "https://example.com", instagram_url: "", phone: "03-0000-0000" },
      ]) {
        expect((await updateStorePatchAction(id, patch as never)).ok).toBe(true);
      }
      const after = await readRow(tx, id);
      expect(after).toMatchObject({
        genre: "居酒屋",
        phone: "03-0000-0000",
        lat: 35.64,
        contact_email: "a@example.com",
        assigned_sales_user_id: PROFILE_ID,
      });
      // 編集対象外の列は変わらない
      for (const key of ["id", "tenant_id", "created_at", "stage", "memo", "basic_info"]) {
        expect(after[key], key).toEqual(before[key]);
      }
    });
  });
});
