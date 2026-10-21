import { describe, expect, it } from "vitest";
import { normalizeContactEmail } from "@/lib/domain/store-contact-email";

describe("normalizeContactEmail", () => {
  it("空欄は未登録として許容する", () => {
    expect(normalizeContactEmail("   ")).toEqual({ ok: true, value: "" });
  });
  it("前後の空白は正規化する", () => {
    expect(normalizeContactEmail("  contract@example.com  ")).toEqual({
      ok: true, value: "contract@example.com",
    });
  });
  it("不正な形式や型は拒否する", () => {
    for (const value of ["wrong", "x@@example.com", "a@b", "a b@example.com", "a@example.com\nBcc:hi", null, {}, 123]) {
      expect(normalizeContactEmail(value).ok).toBe(false);
    }
  });
  it("254文字を超える値は拒否する", () => {
    expect(normalizeContactEmail("x".repeat(250) + "@example.com").ok).toBe(false);
  });
});
