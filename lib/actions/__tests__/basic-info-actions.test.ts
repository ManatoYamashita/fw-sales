/**
 * `updateBasicInfoFieldAction` の並行書き込み対策の検証
 * (feat/ai-research-quality-ux-hardening、Plan §12.2.2 / 承認レビュー指摘5)。
 *
 * 旧実装は `repos.store.mergeBasicInfo`(トランザクション外・行ロック無しの
 * read-merge-write)を直接呼んでいた。`stores` の更新は**全列 SET** なので、
 * review 側の書込み(とくに約30 key を一度に書く「残りを採用して調査完了」)と
 * 並行実行されると lost update が起きる。ここでは
 * 「transaction 内で `getForUpdate` を使う」ことをコードで固定する。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BasicInfo } from "@/types/basic-info";

vi.mock("server-only", () => ({}));

const {
  mockStoreGet,
  mockStoreGetForUpdate,
  mockStoreUpdate,
  mockMergeBasicInfoRepo,
  mockTransaction,
  mockRevalidateTag,
  mockUpdateTag,
} = vi.hoisted(() => ({
  mockStoreGet: vi.fn(),
  mockStoreGetForUpdate: vi.fn(),
  mockStoreUpdate: vi.fn(),
  mockMergeBasicInfoRepo: vi.fn(),
  mockTransaction: vi.fn(),
  mockRevalidateTag: vi.fn(),
  mockUpdateTag: vi.fn(),
}));

vi.mock("@/lib/repositories", () => ({
  repos: {
    store: {
      get: mockStoreGet,
      getForUpdate: mockStoreGetForUpdate,
      update: mockStoreUpdate,
      mergeBasicInfo: mockMergeBasicInfoRepo,
    },
    transaction: mockTransaction,
  },
}));

// `getForUpdate` と `get` は別 mock。実装が誤って行ロック無しの `get` を使うように
// なった場合にテストが検知できるようにする(research-run-actions.test.ts と同じ規約)。
mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
  fn({
    store: {
      get: mockStoreGet,
      getForUpdate: mockStoreGetForUpdate,
      update: mockStoreUpdate,
      mergeBasicInfo: mockMergeBasicInfoRepo,
    },
  }),
);

vi.mock("next/cache", () => ({ revalidateTag: mockRevalidateTag, updateTag: mockUpdateTag }));

const { updateBasicInfoFieldAction } = await import("../basic-info-actions");
const { CACHE_TAGS } = await import("@/lib/cache");
const { classifyBasicInfoTrust } = await import("@/lib/domain/basic-info-trust");

beforeEach(() => {
  mockStoreGet.mockReset();
  mockStoreGetForUpdate.mockReset();
  mockStoreUpdate.mockReset();
  mockMergeBasicInfoRepo.mockReset();
  mockRevalidateTag.mockReset();
  mockUpdateTag.mockReset();
  // `mockReset` だと `mockImplementation`(tx スコープの生成)まで消えるため clear のみ。
  mockTransaction.mockClear();
  mockStoreGetForUpdate.mockResolvedValue({ id: "store-1", basic_info: {} });
});

describe("updateBasicInfoFieldAction — 行ロック(承認レビュー指摘5)", () => {
  it("transaction内でgetForUpdateを使い、ロック無しのgetを使わない", async () => {
    const result = await updateBasicInfoFieldAction("store-1", "concept", "東北の郷土料理");

    expect(result.ok).toBe(true);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockStoreGetForUpdate).toHaveBeenCalledWith("store-1");
    expect(mockStoreGet).not.toHaveBeenCalled();
  });

  it("行ロック無しの repository.mergeBasicInfo は使わない", async () => {
    await updateBasicInfoFieldAction("store-1", "concept", "東北の郷土料理");
    expect(mockMergeBasicInfoRepo).not.toHaveBeenCalled();
  });

  it("filled_by=manual で保存する(自動ソースからの保護を維持)", async () => {
    await updateBasicInfoFieldAction("store-1", "concept", "東北の郷土料理");

    const patch = mockStoreUpdate.mock.calls[0]![1] as {
      basic_info: Record<string, { value: string | null; filled_by: string }>;
    };
    expect(patch.basic_info.concept!.filled_by).toBe("manual");
    expect(patch.basic_info.concept!.value).toBe("東北の郷土料理");
  });

  it("既存の他キーを巻き戻さない(read-merge-write がロック内で完結する)", async () => {
    mockStoreGetForUpdate.mockResolvedValue({
      id: "store-1",
      basic_info: {
        review_avg: {
          value: "4.2",
          tier: "A",
          filled_by: "manual",
          updated_at: "2026-08-04T00:00:00.000Z",
        },
      },
    });

    await updateBasicInfoFieldAction("store-1", "concept", "東北の郷土料理");

    const patch = mockStoreUpdate.mock.calls[0]![1] as {
      basic_info: Record<string, { value: string | null }>;
    };
    expect(patch.basic_info.review_avg!.value).toBe("4.2");
    expect(patch.basic_info.concept!.value).toBe("東北の郷土料理");
  });

  it("空文字は未充足(value=null)として保存する(既存仕様)", async () => {
    await updateBasicInfoFieldAction("store-1", "concept", "   ");

    const patch = mockStoreUpdate.mock.calls[0]![1] as {
      basic_info: Record<string, { value: string | null }>;
    };
    expect(patch.basic_info.concept!.value).toBeNull();
  });

  it("未知のキーは拒否し、DBに触れない", async () => {
    const result = await updateBasicInfoFieldAction("store-1", "unknown_key", "x");
    expect(result.ok).toBe(false);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("店舗が存在しなければ failure を返す", async () => {
    mockStoreGetForUpdate.mockResolvedValue(null);
    const result = await updateBasicInfoFieldAction("store-1", "concept", "x");
    expect(result.ok).toBe(false);
    expect(mockStoreUpdate).not.toHaveBeenCalled();
  });
});

describe("updateBasicInfoFieldAction — 店舗詳細のインライン編集 (#335)", () => {
  it("保存直後の再取得で新しい値を読めるよう、店舗詳細・一覧のタグを即時失効する", async () => {
    const result = await updateBasicInfoFieldAction("store-1", "concept", "東北の郷土料理");
    expect(result.ok).toBe(true);
    expect(mockUpdateTag).toHaveBeenCalledWith(CACHE_TAGS.store("store-1"));
    expect(mockUpdateTag).toHaveBeenCalledWith(CACHE_TAGS.stores);
    // stale-while-revalidate だと旧値が返り、入力済み件数や信頼度が古いまま残る。
    const swrTags = mockRevalidateTag.mock.calls.map(([tag]) => tag);
    expect(swrTags).not.toContain(CACHE_TAGS.store("store-1"));
    expect(swrTags).not.toContain(CACHE_TAGS.stores);
  });

  it("AI 調査から採用した値を手で直すと、元の確信度・出典を引き継がない", async () => {
    mockStoreGetForUpdate.mockResolvedValue({
      id: "store-1",
      basic_info: {
        concept: {
          value: "炭火と地酒",
          tier: "B",
          confidence: 92,
          source_urls: ["https://example.com/about"],
          source_quote: "炭火と地酒の店",
          filled_by: "manual",
          updated_at: "2026-10-01T00:00:00.000Z",
        },
      },
    });

    await updateBasicInfoFieldAction("store-1", "concept", "炭火と日本酒");

    const patch = mockStoreUpdate.mock.calls[0]![1] as { basic_info: BasicInfo };
    const saved = patch.basic_info.concept!;
    expect(saved.value).toBe("炭火と日本酒");
    expect(saved.confidence).toBeUndefined();
    expect(saved.source_urls).toBeUndefined();
    expect(saved.source_quote).toBeUndefined();
    // 画面の信頼度は「未評価」になり、元の 92 (緑) を付け直さない。
    expect(classifyBasicInfoTrust(saved)).toEqual({ kind: "unrated" });
  });
});
