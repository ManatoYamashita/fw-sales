/**
 * lib/env.ts の Stage 1 進捗停滞 (stall) 検知しきい値ヘルパの単体テスト。
 *
 * `getStallThresholdMs` / `getStallGraceMs` は `readPositiveInt` (分) を読み、
 * ミリ秒に変換して返す。未設定/不正値はデフォルトにフォールバックする。
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getStallThresholdMs,
  getStallGraceMs,
  getStructurerMaxOutputTokens,
} from "../env";

const KEYS = [
  "DEEP_RESEARCH_STALL_THRESHOLD_MIN",
  "DEEP_RESEARCH_STALL_GRACE_MIN",
  "DEEP_RESEARCH_STRUCTURER_MAX_TOKENS",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("getStallThresholdMs", () => {
  it("未設定ならデフォルト 90 分 (= 5,400,000ms)", () => {
    expect(getStallThresholdMs()).toBe(90 * 60_000);
  });

  it("正常値は 分 * 60_000 で返る", () => {
    process.env.DEEP_RESEARCH_STALL_THRESHOLD_MIN = "120";
    expect(getStallThresholdMs()).toBe(120 * 60_000);
  });

  it("不正値 (0 / 負 / 非数値) はデフォルトにフォールバック", () => {
    for (const bad of ["0", "-5", "abc", ""]) {
      process.env.DEEP_RESEARCH_STALL_THRESHOLD_MIN = bad;
      expect(getStallThresholdMs()).toBe(90 * 60_000);
    }
  });
});

describe("getStallGraceMs", () => {
  it("未設定ならデフォルト 60 分 (= 3,600,000ms)", () => {
    expect(getStallGraceMs()).toBe(60 * 60_000);
  });

  it("正常値は 分 * 60_000 で返る", () => {
    process.env.DEEP_RESEARCH_STALL_GRACE_MIN = "45";
    expect(getStallGraceMs()).toBe(45 * 60_000);
  });

  it("不正値はデフォルトにフォールバック", () => {
    process.env.DEEP_RESEARCH_STALL_GRACE_MIN = "-1";
    expect(getStallGraceMs()).toBe(60 * 60_000);
  });
});

describe("getStructurerMaxOutputTokens", () => {
  it("未設定ならデフォルト 16384", () => {
    expect(getStructurerMaxOutputTokens()).toBe(16384);
  });

  it("正常値はそのまま返る", () => {
    process.env.DEEP_RESEARCH_STRUCTURER_MAX_TOKENS = "32768";
    expect(getStructurerMaxOutputTokens()).toBe(32768);
  });

  it("不正値 (0 / 負 / 非数値) はデフォルトにフォールバック", () => {
    for (const bad of ["0", "-1", "abc", ""]) {
      process.env.DEEP_RESEARCH_STRUCTURER_MAX_TOKENS = bad;
      expect(getStructurerMaxOutputTokens()).toBe(16384);
    }
  });
});
