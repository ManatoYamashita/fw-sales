/**
 * RateLimiter のテスト。
 *
 * 関連: design.md §「RateLimiter」, requirements.md §6.3
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetRateLimitForTest, checkRateLimit } from "../rate-limiter";

describe("checkRateLimit", () => {
  beforeEach(() => {
    _resetRateLimitForTest();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-09T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    _resetRateLimitForTest();
  });

  it("per-store: 5 回までは ok、6 回目は per_store reject (Req 6.3)", () => {
    for (let i = 0; i < 5; i++) {
      const r = checkRateLimit("store_001");
      expect(r.ok).toBe(true);
    }
    const sixth = checkRateLimit("store_001");
    expect(sixth.ok).toBe(false);
    if (!sixth.ok) {
      expect(sixth.reason).toBe("per_store");
      expect(sixth.message).toMatch(/10 分以内に 5 回/);
    }
  });

  it("per-store: 10 分後にカウントがリセットされる", () => {
    for (let i = 0; i < 5; i++) {
      checkRateLimit("store_001");
    }
    // 10 分 + 1 秒進める(window から完全に外れるよう少し余分に進める)
    vi.advanceTimersByTime(10 * 60 * 1000 + 1000);
    const r = checkRateLimit("store_001");
    expect(r.ok).toBe(true);
  });

  it("per-store: 異なる storeId は独立してカウント", () => {
    for (let i = 0; i < 5; i++) {
      checkRateLimit("store_A");
    }
    // store_A は 6 回目で reject されるが、store_B は別カウント
    const a6 = checkRateLimit("store_A");
    expect(a6.ok).toBe(false);
    const b1 = checkRateLimit("store_B");
    expect(b1.ok).toBe(true);
  });

  it("global: 60 秒以内 10 回までは ok、11 回目は global reject", () => {
    // 10 個の異なる storeId で 10 回呼出 → global counter が 10 に達する
    for (let i = 0; i < 10; i++) {
      const r = checkRateLimit(`store_${i}`);
      expect(r.ok).toBe(true);
    }
    // 11 個目は別 storeId だが global で reject される
    const eleventh = checkRateLimit("store_X");
    expect(eleventh.ok).toBe(false);
    if (!eleventh.ok) {
      expect(eleventh.reason).toBe("global");
      expect(eleventh.message).toMatch(/60 秒以内に 10 回/);
    }
  });

  it("global: 60 秒後にカウントがリセットされる", () => {
    for (let i = 0; i < 10; i++) {
      checkRateLimit(`store_${i}`);
    }
    vi.advanceTimersByTime(60 * 1000 + 1000);
    const r = checkRateLimit("store_after");
    expect(r.ok).toBe(true);
  });

  it("storeId null: per-store 判定をスキップして global のみチェック", () => {
    // null で 6 回呼出 → per-store reject なし、global のみで判定
    for (let i = 0; i < 6; i++) {
      const r = checkRateLimit(null);
      expect(r.ok).toBe(true);
    }
  });

  it("rate limit 拒否時はカウントを進めない (API コスト発生前防御)", () => {
    for (let i = 0; i < 5; i++) {
      checkRateLimit("store_001");
    }
    // 6 回目は reject(カウント増えず)
    const sixth = checkRateLimit("store_001");
    expect(sixth.ok).toBe(false);
    // 9 分 59 秒後 → ぎりぎり window 内、rejected も連続して reject される(global cnt も増えてない)
    vi.advanceTimersByTime(9 * 60 * 1000 + 59 * 1000);
    const seventh = checkRateLimit("store_001");
    expect(seventh.ok).toBe(false);
    // global は 5 回しかカウントされていないので別 storeId は ok
    for (let i = 0; i < 5; i++) {
      const r = checkRateLimit(`store_other_${i}`);
      expect(r.ok).toBe(true);
    }
  });

  it("_resetRateLimitForTest で全状態がクリアされる", () => {
    for (let i = 0; i < 5; i++) {
      checkRateLimit("store_001");
    }
    _resetRateLimitForTest();
    const r = checkRateLimit("store_001");
    expect(r.ok).toBe(true);
  });
});
