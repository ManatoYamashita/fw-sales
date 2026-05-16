/**
 * `mockProfileRepo` の単体テスト (auth-and-notifications spec, Issue #16)
 *
 * カバレッジ (3 ケース):
 * 1. `findByDisplayName` 完全一致
 * 2. `createPlaceholder` の email 形式 (`placeholder-{slug}@local.invalid`)
 * 3. `findManyByIds` の空配列入力時の挙動 (空配列を返し DB アクセスなし)
 *
 * 関連: requirements.md §2.1, §2.5, §3.4, §3.5
 */

import { describe, expect, it, beforeEach } from "vitest";
import { mockProfileRepo } from "../profile";
import { mockDb } from "../db";
import type { Profile } from "@/types/profile";

const FIXED_DATE = "2026-05-16";

function seedProfile(p: Omit<Profile, "created_at" | "updated_at">): void {
  mockDb.profiles.set(p.id, {
    ...p,
    created_at: FIXED_DATE,
    updated_at: FIXED_DATE,
  });
}

describe("mockProfileRepo", () => {
  beforeEach(() => {
    // 各テスト前に Mock DB の profiles をクリーンアップ
    mockDb.profiles.clear();
  });

  it("findByDisplayName: 完全一致で profile を返し、不一致は null", async () => {
    seedProfile({
      id: "u1",
      email: "sato@example.com",
      display_name: "佐藤",
      avatar_url: null,
      role: "member",
    });
    seedProfile({
      id: "u2",
      email: "watabe@example.com",
      display_name: "渡部",
      avatar_url: null,
      role: "member",
    });

    const hit = await mockProfileRepo.findByDisplayName("佐藤");
    expect(hit?.id).toBe("u1");

    const miss = await mockProfileRepo.findByDisplayName("田中");
    expect(miss).toBeNull();
  });

  it("createPlaceholder: email は `placeholder-{slug}@local.invalid` 形式、role='placeholder'", async () => {
    const placeholder = await mockProfileRepo.createPlaceholder({
      displayName: "山田 太郎",
      slug: "yamada-taro",
    });

    expect(placeholder.email).toBe("placeholder-yamada-taro@local.invalid");
    expect(placeholder.role).toBe("placeholder");
    expect(placeholder.display_name).toBe("山田 太郎");
    expect(placeholder.id).toMatch(/^[0-9a-f-]{36}$/); // UUID v4 形式
    // mockDb にも書き込まれている
    expect(mockDb.profiles.get(placeholder.id)).toEqual(placeholder);
  });

  it("findManyByIds: 空配列入力時は空配列を返す (DB を走査しない)", async () => {
    seedProfile({
      id: "u1",
      email: "sato@example.com",
      display_name: "佐藤",
      avatar_url: null,
      role: "member",
    });

    const result = await mockProfileRepo.findManyByIds([]);
    expect(result).toEqual([]);
  });
});
