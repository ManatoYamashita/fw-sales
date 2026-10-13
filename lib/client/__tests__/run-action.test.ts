/**
 * `runAction` の結果 → トーストの対応を固定する (#327)。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const toastSpy = vi.hoisted(() => ({
  show: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));
vi.mock("@/components/ui/toast", () => ({ toast: toastSpy }));

import {
  ACTION_EXCEPTION_MESSAGE,
  ACTION_FAILURE_FALLBACK_MESSAGE,
  runAction,
} from "../run-action";

/** Next.js が redirect() を client へ伝えるときのエラーと同じ形。 */
function redirectError(): Error & { digest: string } {
  return Object.assign(new Error("NEXT_REDIRECT"), {
    digest: "NEXT_REDIRECT;push;/stores;307;",
  });
}

beforeEach(() => {
  for (const fn of Object.values(toastSpy)) fn.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("runAction: 成功", () => {
  it("Action が message を返したら、そちらを成功トーストに出す", async () => {
    const result = await runAction(
      async () => ({ ok: true as const, data: 1, message: "店舗を登録しました" }),
      { success: "登録しました" },
    );
    expect(result).toEqual({ ok: true, data: 1, message: "店舗を登録しました" });
    expect(toastSpy.show).toHaveBeenCalledWith("店舗を登録しました", "success");
  });

  it("message が無ければ success の文を出す", async () => {
    await runAction(async () => ({ ok: true as const, data: undefined }), {
      success: "更新しました",
    });
    expect(toastSpy.show).toHaveBeenCalledWith("更新しました", "success");
  });

  it("関数形の success は結果から文と色を組み立てる (一部だけ成功した一括処理など)", async () => {
    await runAction(
      async () => ({ ok: true as const, data: { deleted: 2, requested: 3 } }),
      {
        success: ({ deleted, requested }) => ({
          message: `${deleted}/${requested} 件を削除しました`,
          tone: "warning",
        }),
      },
    );
    expect(toastSpy.show).toHaveBeenCalledWith("2/3 件を削除しました", "warning");
  });

  it("silentSuccess は成功トーストを出さない", async () => {
    const result = await runAction(async () => ({ ok: true as const, data: 1 }), {
      silentSuccess: true,
    });
    expect(result?.ok).toBe(true);
    expect(toastSpy.show).not.toHaveBeenCalled();
    expect(toastSpy.success).not.toHaveBeenCalled();
  });
});

describe("runAction: 失敗", () => {
  it("ok:false の文をエラートーストに出す", async () => {
    const result = await runAction(
      async () => ({ ok: false as const, error: "店舗が見つかりませんでした" }),
      { success: "更新しました" },
    );
    expect(result).toEqual({ ok: false, error: "店舗が見つかりませんでした" });
    expect(toastSpy.error).toHaveBeenCalledWith("店舗が見つかりませんでした");
    expect(toastSpy.show).not.toHaveBeenCalled();
  });

  it("silentSuccess でも失敗はトーストで出す", async () => {
    await runAction(async () => ({ ok: false as const, error: "既読にできませんでした" }), {
      silentSuccess: true,
    });
    expect(toastSpy.error).toHaveBeenCalledWith("既読にできませんでした");
  });

  it("空の文が返ってきたら共通の文で補う", async () => {
    await runAction(async () => ({ ok: false as const, error: "" }), { success: "x" });
    expect(toastSpy.error).toHaveBeenCalledWith(ACTION_FAILURE_FALLBACK_MESSAGE);
  });
});

describe("runAction: 例外", () => {
  it("通信断やサーバの throw は共通の文で知らせ、null を返して画面に留まる", async () => {
    const result = await runAction(
      async () => {
        throw new TypeError("Failed to fetch");
      },
      { success: "更新しました" },
    );
    expect(result).toBeNull();
    expect(toastSpy.error).toHaveBeenCalledWith(ACTION_EXCEPTION_MESSAGE);
    // 例外の英語の文は画面に出さない。
    expect(toastSpy.error).not.toHaveBeenCalledWith(expect.stringContaining("fetch"));
  });

  it("silentSuccess でも例外はトーストで出す", async () => {
    await runAction(
      async () => {
        throw new Error("boom");
      },
      { silentSuccess: true },
    );
    expect(toastSpy.error).toHaveBeenCalledWith(ACTION_EXCEPTION_MESSAGE);
  });

  it("redirect は成功として成功トーストを出し、遷移のために投げ直す", async () => {
    const error = redirectError();
    await expect(
      runAction(
        async () => {
          throw error;
        },
        { success: "店舗を削除しました" },
      ),
    ).rejects.toBe(error);
    expect(toastSpy.success).toHaveBeenCalledWith("店舗を削除しました");
    expect(toastSpy.error).not.toHaveBeenCalled();
  });

  it("notFound など Next.js の他の制御用エラーは、トーストを出さずに投げ直す", async () => {
    const error = Object.assign(new Error("NEXT_HTTP_ERROR_FALLBACK;404"), {
      digest: "NEXT_HTTP_ERROR_FALLBACK;404",
    });
    await expect(
      runAction(
        async () => {
          throw error;
        },
        { success: "更新しました" },
      ),
    ).rejects.toBe(error);
    expect(toastSpy.error).not.toHaveBeenCalled();
    expect(toastSpy.success).not.toHaveBeenCalled();
  });
});
