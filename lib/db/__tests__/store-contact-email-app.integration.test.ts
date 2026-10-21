/**
 * 契約連絡先メールアドレス (#384 Phase 2) を、アプリの経路から実 PostgreSQL で確かめる。
 *
 * Phase 1 の `store-contact-email-column.integration.test.ts` は「列を知らない書き込みが値を消さない」
 * ことを確かめた。ここでは `schema.ts` が列を知った後の経路を確かめる。
 * - repository の作成・部分更新: キーが無い / undefined なら残し、空文字なら消す
 * - JSON インポート (`importJsonAction`): 旧 JSON は既存値を残し、書き出した JSON は値を戻し、
 *   不正な値が 1 件でもあれば何も書かない。商談などほかのデータも変えない
 *
 * 他の結合テストと DB を共有するため、各テストはトランザクション内で行い、最後に ROLLBACK する。
 * `importJsonAction` が開くトランザクションは、外側のトランザクションの SAVEPOINT に差し替える。
 */
import { describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

import type { Store, StoreInput } from "@/types/store";

const holder = vi.hoisted(() => ({ tx: null as null | { transaction: (fn: never) => Promise<unknown> } }));

vi.mock("@/lib/db/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db/client")>("@/lib/db/client");
  return {
    ...actual,
    db: {
      transaction: (fn: never) => {
        if (!holder.tx) throw new Error("importJsonAction はテスト用のトランザクションの中で呼ぶ");
        return holder.tx.transaction(fn);
      },
    },
  };
});
vi.mock("@/lib/actions/_authz", () => ({
  requireAdmin: vi.fn().mockResolvedValue({
    ok: true,
    profile: { id: "00000000-0000-4000-8000-000000000001", email: "admin@example.test", role: "admin" },
  }),
}));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn(), updateTag: vi.fn() }));

const { db } = await vi.importActual<typeof import("@/lib/db/client")>("@/lib/db/client");
const { deals } = await import("@/lib/db/schema");
const { makeStoreRepo } = await import("@/lib/db/store-repository");
const { SEED_STORES, SEED_DEALS } = await import("@/lib/db/seed-data");
const { importJsonAction } = await import("@/lib/actions/data-actions");

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const SEED_INPUT: StoreInput = { ...SEED_STORES[0]! };

/** `work` を実行した後、必ず ROLLBACK する。 */
async function inRolledBackTransaction(work: (tx: Tx) => Promise<void>): Promise<void> {
  const rollback = new Error("rollback");
  await expect(
    db.transaction(async (tx) => {
      holder.tx = tx as never;
      try {
        await work(tx);
      } finally {
        holder.tx = null;
      }
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

function jsonFile(payload: unknown): FormData {
  const formData = new FormData();
  formData.set("file", new File([JSON.stringify(payload)], "snapshot.json", { type: "application/json" }));
  return formData;
}

/** 店舗と、その店舗の商談を 1 件作る。 */
async function createStoreWithDeal(tx: Tx, contact_email: string): Promise<Store> {
  const created = await makeStoreRepo(tx).create({ ...SEED_INPUT, contact_email });
  await tx.insert(deals).values({ ...SEED_DEALS[0]!, id: `deal_${created.id}`, store_id: created.id });
  return created;
}

describe("repository の作成・部分更新 (#384 Phase 2)", () => {
  it("作成したアドレスを読み出せる", async () => {
    await inRolledBackTransaction(async (tx) => {
      const created = await makeStoreRepo(tx).create({ ...SEED_INPUT, contact_email: "a@example.com" });
      expect(await makeStoreRepo(tx).get(created.id)).toMatchObject({ contact_email: "a@example.com" });
    });
  });

  it("キーが無い・undefined の patch では残り、空文字の patch で消える", async () => {
    await inRolledBackTransaction(async (tx) => {
      const repo = makeStoreRepo(tx);
      const created = await repo.create({ ...SEED_INPUT, contact_email: "keep@example.com" });
      await repo.update(created.id, { memo: "メモ" });
      await repo.update(created.id, { genre: "居酒屋", contact_email: undefined });
      expect(await readContactEmail(tx, created.id)).toBe("keep@example.com");
      await repo.update(created.id, { contact_email: "" });
      expect(await readContactEmail(tx, created.id)).toBe("");
    });
  });
});

describe("JSON インポート (#384 Phase 2)", () => {
  it("アドレスのキーが無い旧 JSON では、保存済みのアドレスを残し、ほかの項目は取り込む", async () => {
    await inRolledBackTransaction(async (tx) => {
      const created = await createStoreWithDeal(tx, "saved@example.com");
      const legacy: Record<string, unknown> = { ...created, memo: "旧JSONのメモ" };
      delete legacy.contact_email;
      const result = await importJsonAction(null, jsonFile({ stores: [legacy] }));
      expect(result).toMatchObject({ ok: true });
      expect(await readContactEmail(tx, created.id)).toBe("saved@example.com");
      expect((await makeStoreRepo(tx).get(created.id))?.memo).toBe("旧JSONのメモ");
    });
  });

  it("書き出した JSON を戻すと、アドレスも戻る (空文字のアドレスは空文字に戻る)", async () => {
    await inRolledBackTransaction(async (tx) => {
      const withEmail = await createStoreWithDeal(tx, "export@example.com");
      const withoutEmail = await createStoreWithDeal(tx, "");
      const repo = makeStoreRepo(tx);
      const exported = (await repo.list()).filter((s) => [withEmail.id, withoutEmail.id].includes(s.id));
      expect(exported.map((s) => s.contact_email).sort()).toEqual(["", "export@example.com"]);

      // 書き出した後に変わった値が、インポートで書き出し時点へ戻る
      await repo.update(withEmail.id, { contact_email: "changed@example.com" });
      await repo.update(withoutEmail.id, { contact_email: "added@example.com" });
      const result = await importJsonAction(null, jsonFile({ stores: exported }));
      expect(result).toMatchObject({ ok: true });
      expect(await readContactEmail(tx, withEmail.id)).toBe("export@example.com");
      expect(await readContactEmail(tx, withoutEmail.id)).toBe("");
    });
  });

  it("不正なアドレスが 1 件でもあれば、ほかの店舗も含めて何も書かず、商談も残る", async () => {
    await inRolledBackTransaction(async (tx) => {
      const first = await createStoreWithDeal(tx, "first@example.com");
      const second = await createStoreWithDeal(tx, "second@example.com");
      const result = await importJsonAction(null, jsonFile({
        stores: [
          { ...first, memo: "書かれてはいけないメモ", contact_email: "ok@example.com" },
          { ...second, contact_email: "broken@@example.com" },
        ],
      }));
      expect(result).toMatchObject({ ok: false });
      expect(await readContactEmail(tx, first.id)).toBe("first@example.com");
      expect(await readContactEmail(tx, second.id)).toBe("second@example.com");
      expect((await makeStoreRepo(tx).get(first.id))?.memo).toBe(SEED_INPUT.memo);
      const dealRows = (await tx.execute(
        sql`SELECT id FROM deals WHERE store_id IN (${first.id}, ${second.id}) ORDER BY id`,
      )) as unknown as Array<{ id: string }>;
      expect(dealRows).toHaveLength(2);
    });
  });
});
