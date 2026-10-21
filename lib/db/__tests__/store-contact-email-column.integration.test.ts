/**
 * 契約連絡先メールアドレスの列 (migration 0033, #384) を、実 PostgreSQL で確かめる。
 *
 * 0033 は `lib/db/schema.ts` を変えない expand の migration で、アプリはまだ `contact_email` を知らない。
 * この段階の約束は 2 つある。
 * - 列は NOT NULL・既定値は空文字で、列を指定しない INSERT は空欄 (未登録) になる
 * - 列を知らないアプリの書き込み (店舗の作成・部分更新・JSON インポートと seed の upsert) が、
 *   保存済みのアドレスを消さない
 * 後者は、アプリへの反映 (#384 の後続 PR) で `toDbRow` などが列を知った後も守るべき約束でもある。
 * 「キーの無い入力」で既存値を空文字に上書きするようになったら、ここで落ちる。
 *
 * CI の `Audit DB integration` job (migration 適用済みの postgres:15-alpine) で実行する。
 * 他の結合テストと DB を共有するため、各テストはトランザクション内で行い、最後に ROLLBACK する。
 */
import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import type { Store, StoreInput } from "@/types/store";

const { db } = await import("@/lib/db/client");
const { stores } = await import("@/lib/db/schema");
const { makeStoreRepo, toDbRow } = await import("@/lib/db/store-repository");
const { SEED_STORES } = await import("@/lib/db/seed-data");

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const SAVED_EMAIL = "contract-384@example.test";

/** seed の店舗を入力にする (id・日付は create が振り直す)。 */
const SEED_INPUT: StoreInput = { ...SEED_STORES[0]! };

/** `work` を実行した後、必ず ROLLBACK する。 */
async function inRolledBackTransaction(work: (tx: Tx) => Promise<void>): Promise<void> {
  const rollback = new Error("rollback");
  await expect(
    db.transaction(async (tx) => {
      await work(tx);
      throw rollback;
    }),
  ).rejects.toBe(rollback);
}

async function readContactEmail(tx: Tx, id: string): Promise<unknown> {
  const rows = (await tx.execute(
    sql`SELECT contact_email FROM stores WHERE id = ${id}`,
  )) as unknown as Array<{ contact_email: unknown }>;
  return rows[0]?.contact_email;
}

/** 列を知らないアプリで店舗を作り、アドレスだけを SQL で保存しておく。 */
async function createStoreWithEmail(tx: Tx): Promise<Store> {
  const created = await makeStoreRepo(tx).create({ ...SEED_INPUT, memo: "更新前のメモ" });
  await tx.execute(sql`UPDATE stores SET contact_email = ${SAVED_EMAIL} WHERE id = ${created.id}`);
  return created;
}

describe("stores.contact_email の列 (#384)", () => {
  it("text・NOT NULL で、既定値は空文字", async () => {
    const columns = (await db.execute(sql`
      SELECT data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'stores' AND column_name = 'contact_email'`,
    )) as unknown as Array<Record<string, unknown>>;
    expect(columns).toEqual([
      { data_type: "text", is_nullable: "NO", column_default: "''::text" },
    ]);
  });

  it("列を知らないアプリが作った店舗は、空欄 (未登録) になる", async () => {
    await inRolledBackTransaction(async (tx) => {
      const created = await makeStoreRepo(tx).create(SEED_INPUT);
      expect(await readContactEmail(tx, created.id)).toBe("");
      expect(await makeStoreRepo(tx).get(created.id)).toMatchObject({ id: created.id, name: SEED_INPUT.name });
    });
  });

  it("ほかの項目の部分更新では、保存済みのアドレスが残る", async () => {
    await inRolledBackTransaction(async (tx) => {
      const created = await createStoreWithEmail(tx);
      const updated = await makeStoreRepo(tx).update(created.id, { memo: "更新後のメモ" });
      expect(updated?.memo).toBe("更新後のメモ");
      expect(await readContactEmail(tx, created.id)).toBe(SAVED_EMAIL);
    });
  });

  it("基本情報 (basic_info) の更新でも、保存済みのアドレスが残る", async () => {
    await inRolledBackTransaction(async (tx) => {
      const created = await createStoreWithEmail(tx);
      await makeStoreRepo(tx).mergeBasicInfo(created.id, {}, "manual");
      expect(await readContactEmail(tx, created.id)).toBe(SAVED_EMAIL);
    });
  });

  it("アドレスを含まない JSON の再投入 (インポート・seed と同じ upsert) で、既存のアドレスが消えない", async () => {
    await inRolledBackTransaction(async (tx) => {
      const created = await createStoreWithEmail(tx);
      // contact_email のキーを持たない、列の追加前に書き出した JSON の店舗
      const legacy = { ...created, memo: "インポートしたメモ" } as Store;
      expect("contact_email" in legacy).toBe(false);
      const row = toDbRow(legacy);
      await tx.insert(stores).values(row).onConflictDoUpdate({ target: stores.id, set: row });

      expect(await readContactEmail(tx, created.id)).toBe(SAVED_EMAIL);
      expect((await makeStoreRepo(tx).get(created.id))?.memo).toBe("インポートしたメモ");
    });
  });

  it("アドレスを含まない JSON からの新規作成は、空欄 (未登録) になる", async () => {
    await inRolledBackTransaction(async (tx) => {
      const legacy = { ...SEED_STORES[0]!, id: "store_contact_email_384_new" } as Store;
      const row = toDbRow(legacy);
      await tx.insert(stores).values(row).onConflictDoUpdate({ target: stores.id, set: row });
      expect(await readContactEmail(tx, legacy.id)).toBe("");
    });
  });
});
