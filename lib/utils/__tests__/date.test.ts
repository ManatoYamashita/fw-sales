import { describe, expect, it } from "vitest";
import { isValidYmd, todayInTimeZone } from "@/lib/utils/date";

describe("isValidYmd", () => {
  it("実在する YYYY-MM-DD を受理する", () => {
    expect(isValidYmd("2026-07-15")).toBe(true);
    expect(isValidYmd("2026-01-01")).toBe(true);
    expect(isValidYmd("2026-12-31")).toBe(true);
  });

  it("うるう年の 2/29 を正しく判定する", () => {
    expect(isValidYmd("2024-02-29")).toBe(true);
    expect(isValidYmd("2026-02-29")).toBe(false);
  });

  it("存在しない日付を拒否する", () => {
    expect(isValidYmd("2026-02-30")).toBe(false);
    expect(isValidYmd("2026-13-01")).toBe(false);
    expect(isValidYmd("2026-00-10")).toBe(false);
    expect(isValidYmd("2026-04-31")).toBe(false);
  });

  it("形式違いを拒否する", () => {
    expect(isValidYmd("")).toBe(false);
    expect(isValidYmd("2026/07/15")).toBe(false);
    expect(isValidYmd("2026-7-15")).toBe(false);
    expect(isValidYmd("20260715")).toBe(false);
    expect(isValidYmd("2026-07-15T00:00:00Z")).toBe(false);
  });
});

describe("todayInTimeZone", () => {
  it("UTC日付ではなく指定タイムゾーンの暦日を返す", () => {
    const now = new Date("2026-07-16T15:30:00.000Z");
    expect(todayInTimeZone("Asia/Tokyo", now)).toBe("2026-07-17");
    expect(todayInTimeZone("UTC", now)).toBe("2026-07-16");
  });
});
