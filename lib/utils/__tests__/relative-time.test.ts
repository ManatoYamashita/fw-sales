import { describe, it, expect } from "vitest";
import {
  formatRelativeTime,
  formatDuration,
  formatElapsed,
} from "@/lib/utils/relative-time";

const NOW = new Date("2026-05-24T12:00:00Z");

describe("formatRelativeTime", () => {
  it("null / undefined / 不正 ISO は '—'", () => {
    expect(formatRelativeTime(null, NOW)).toBe("—");
    expect(formatRelativeTime(undefined, NOW)).toBe("—");
    expect(formatRelativeTime("not-a-date", NOW)).toBe("—");
  });

  it("未来時刻は 'たった今'", () => {
    expect(formatRelativeTime("2026-05-24T12:00:30Z", NOW)).toBe("たった今");
  });

  it("60 秒未満は <秒>秒前", () => {
    expect(formatRelativeTime("2026-05-24T11:59:30Z", NOW)).toBe("30秒前");
    expect(formatRelativeTime("2026-05-24T11:59:01Z", NOW)).toBe("59秒前");
  });

  it("60 分未満は <分>分前", () => {
    expect(formatRelativeTime("2026-05-24T11:55:00Z", NOW)).toBe("5分前");
    expect(formatRelativeTime("2026-05-24T11:01:00Z", NOW)).toBe("59分前");
  });

  it("24 時間未満は <時>時間前", () => {
    expect(formatRelativeTime("2026-05-24T09:00:00Z", NOW)).toBe("3時間前");
    expect(formatRelativeTime("2026-05-23T13:00:00Z", NOW)).toBe("23時間前");
  });

  it("それ以上は <日>日前", () => {
    expect(formatRelativeTime("2026-05-23T12:00:00Z", NOW)).toBe("1日前");
    expect(formatRelativeTime("2026-05-17T12:00:00Z", NOW)).toBe("7日前");
  });
});

describe("formatDuration", () => {
  it("null / 不正 / 逆順は '—'", () => {
    expect(formatDuration(null, "2026-05-24T12:00:00Z")).toBe("—");
    expect(formatDuration("2026-05-24T12:00:00Z", null)).toBe("—");
    expect(formatDuration("bad", "2026-05-24T12:00:00Z")).toBe("—");
    expect(formatDuration("2026-05-24T12:00:00Z", "2026-05-24T11:00:00Z")).toBe(
      "—",
    );
  });

  it("60 秒未満は <秒>s", () => {
    expect(formatDuration("2026-05-24T12:00:00Z", "2026-05-24T12:00:30Z")).toBe(
      "30s",
    );
  });

  it("60 分未満は <分>m", () => {
    expect(formatDuration("2026-05-24T12:00:00Z", "2026-05-24T12:05:00Z")).toBe(
      "5m",
    );
  });

  it("24 時間未満は <時>h <分>m (分 0 なら h のみ)", () => {
    expect(formatDuration("2026-05-24T12:00:00Z", "2026-05-24T14:13:00Z")).toBe(
      "2h 13m",
    );
    expect(formatDuration("2026-05-24T12:00:00Z", "2026-05-24T14:00:00Z")).toBe(
      "2h",
    );
  });

  it("それ以上は <日>d <時>h (時 0 なら d のみ)", () => {
    expect(formatDuration("2026-05-22T12:00:00Z", "2026-05-24T15:00:00Z")).toBe(
      "2d 3h",
    );
    expect(formatDuration("2026-05-22T12:00:00Z", "2026-05-24T12:00:00Z")).toBe(
      "2d",
    );
  });
});

describe("formatElapsed", () => {
  it("start = null は '—'", () => {
    expect(formatElapsed(null, NOW)).toBe("—");
  });

  it("now - start を formatDuration と同形式で返す", () => {
    expect(formatElapsed("2026-05-24T11:45:00Z", NOW)).toBe("15m");
    expect(formatElapsed("2026-05-24T08:47:00Z", NOW)).toBe("3h 13m");
  });
});
