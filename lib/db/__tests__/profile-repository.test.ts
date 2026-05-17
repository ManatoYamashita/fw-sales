/**
 * `makeProfileRepo` の単体テスト (auth-and-notifications spec, Issue #16)
 *
 * カバレッジ (3 ケース):
 * 1. `findByDisplayName` 完全一致 → row → Profile 変換
 * 2. `createPlaceholder` の email 形式 (`placeholder-{slug}@local.invalid`)
 * 3. `findManyByIds` の空配列入力時の挙動 (SELECT を発行せず空配列を返す)
 *
 * 実 DB 接続は使用しない。`handoff-repository.test.ts` と同じチェイナブル
 * mock executor パターンを利用。
 *
 * 関連: requirements.md §2.1, §2.5, §3.4, §3.5
 */

import { describe, expect, it, vi } from "vitest";

// `lib/db/client.ts` は top-level で `assertEnv("DATABASE_URL")` を発火するため、
// 単体テスト環境(env 未設定)では import だけで失敗する。ダミー化する。
vi.mock("@/lib/db/client", () => ({
  db: {},
  sql: {},
}));

const { makeProfileRepo } = await import("../profile-repository");

function createChainable(rows: unknown[] = []) {
  const chain: Record<string, ReturnType<typeof vi.fn> | unknown> = {};
  const methods = [
    "select",
    "from",
    "where",
    "limit",
    "orderBy",
    "insert",
    "values",
    "update",
    "set",
    "delete",
    "returning",
    "onConflictDoUpdate",
  ] as const;
  for (const m of methods) {
    chain[m] = vi.fn(() => chain);
  }
  chain.then = (resolve: (value: unknown) => void) => resolve(rows);
  return chain as Record<(typeof methods)[number], ReturnType<typeof vi.fn>> &
    PromiseLike<unknown>;
}

describe("makeProfileRepo", () => {
  it("findByDisplayName: 完全一致 row を Profile 型に変換して返す", async () => {
    const chain = createChainable([
      {
        id: "u1",
        email: "sato@example.com",
        display_name: "佐藤",
        avatar_url: null,
        role: "member",
        created_at: "2026-05-16",
        updated_at: "2026-05-16",
      },
    ]);
    const repo = makeProfileRepo(chain as never);

    const result = await repo.findByDisplayName("佐藤");
    expect(result?.id).toBe("u1");
    expect(result?.display_name).toBe("佐藤");
    expect(result?.role).toBe("member");
    expect(chain.select).toHaveBeenCalled();
    expect(chain.from).toHaveBeenCalled();
    expect(chain.where).toHaveBeenCalled();
    expect(chain.limit).toHaveBeenCalledWith(1);
  });

  it("createPlaceholder: email は `placeholder-{slug}@local.invalid` 形式、role='placeholder'", async () => {
    const chain = createChainable();
    const repo = makeProfileRepo(chain as never);

    const placeholder = await repo.createPlaceholder({
      displayName: "山田 太郎",
      slug: "yamada-taro",
    });

    expect(placeholder.email).toBe("placeholder-yamada-taro@local.invalid");
    expect(placeholder.role).toBe("placeholder");
    expect(placeholder.display_name).toBe("山田 太郎");
    expect(placeholder.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(chain.insert).toHaveBeenCalled();
    expect(chain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "placeholder-yamada-taro@local.invalid",
        role: "placeholder",
        display_name: "山田 太郎",
      }),
    );
  });

  it("findManyByIds: 空配列入力時は SELECT を発行せず空配列を返す", async () => {
    const chain = createChainable();
    const repo = makeProfileRepo(chain as never);

    const result = await repo.findManyByIds([]);
    expect(result).toEqual([]);
    expect(chain.select).not.toHaveBeenCalled();
  });
});
