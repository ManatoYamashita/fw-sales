import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  dismissToast,
  getToasts,
  pauseToast,
  resumeToast,
  toast,
  TOAST_TIMEOUT_MS,
} from "../toast";

function clearToasts() {
  for (const item of getToasts()) dismissToast(item.id);
}

describe("トーストの通知寿命", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearToasts();
  });

  afterEach(() => {
    clearToasts();
    vi.useRealTimers();
  });

  it("エラーは自動消去せず、明示的な dismiss まで残る", () => {
    toast.error("保存に失敗しました");

    vi.advanceTimersByTime(TOAST_TIMEOUT_MS * 2);

    expect(getToasts()).toHaveLength(1);
    expect(getToasts()[0]?.tone).toBe("error");
  });

  it("通常通知は5秒後に消える", () => {
    toast.success("保存しました");

    vi.advanceTimersByTime(TOAST_TIMEOUT_MS - 1);
    expect(getToasts()).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(getToasts()).toHaveLength(0);
  });

  it("ホバー・フォーカス中は残り時間を保持して再開できる", () => {
    toast.info("読み込みました");
    const id = getToasts()[0]!.id;

    vi.advanceTimersByTime(2_000);
    pauseToast(id);
    vi.advanceTimersByTime(TOAST_TIMEOUT_MS * 2);
    expect(getToasts()).toHaveLength(1);

    resumeToast(id);
    vi.advanceTimersByTime(TOAST_TIMEOUT_MS - 2_000 - 1);
    expect(getToasts()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(getToasts()).toHaveLength(0);
  });
});
