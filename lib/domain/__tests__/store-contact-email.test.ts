import { describe, expect, it } from "vitest";
import {
  CONTACT_EMAIL_MAX_LENGTH,
  contactEmailMailto,
  normalizeContactEmail,
  omitContactEmail,
} from "@/lib/domain/store-contact-email";

describe("normalizeContactEmail", () => {
  it("空欄は未登録として許容する", () => {
    expect(normalizeContactEmail("")).toEqual({ ok: true, value: "" });
    expect(normalizeContactEmail("   ")).toEqual({ ok: true, value: "" });
  });

  it("前後の空白 (全角スペース・タブ・改行を含む) は除く", () => {
    expect(normalizeContactEmail("  contract@example.com  ")).toEqual({
      ok: true, value: "contract@example.com",
    });
    expect(normalizeContactEmail("　contract@example.co.jp\t\n")).toEqual({
      ok: true, value: "contract@example.co.jp",
    });
  });

  it("よくある形式は受け付け、大文字小文字は変えない", () => {
    for (const value of [
      "a@example.com",
      "Contract.Team+384@Sub-Domain.Example.jp",
      "o'neil_x-1@example.travel",
    ]) {
      expect(normalizeContactEmail(value)).toEqual({ ok: true, value });
    }
  });

  it("不正な形式は拒否する", () => {
    for (const value of [
      "wrong",
      "@example.com",
      "a@",
      "x@@example.com",
      "a@b",
      "a b@example.com",
      "a@example.com\nBcc:hi",
      "a@example.com\r\nBcc: x@example.com",
      ".a@example.com",
      "a.@example.com",
      "a..b@example.com",
      "a@-example.com",
      "a@example-.com",
      "a@example..com",
      "a@example.com.",
      "<a@example.com>",
      "a@example.com,b@example.com",
      "a@example.com?subject=hi",
      "\"a\"@example.com",
      "a\u0000@example.com",
      "契約@example.com",
      "a@例え.jp",
      "a＠example.com",
      "ａ@example.com",
    ]) {
      expect(normalizeContactEmail(value), value).toEqual({
        ok: false, error: expect.any(String),
      });
    }
  });

  it("文字列でない値は拒否する", () => {
    for (const value of [undefined, null, {}, [], 123, true]) {
      expect(normalizeContactEmail(value).ok).toBe(false);
    }
  });

  it("全体は254文字まで、@より前は64文字まで", () => {
    const domain = `${"d".repeat(63)}.${"e".repeat(63)}.${"f".repeat(63)}.example`;
    const longest = `${"x".repeat(CONTACT_EMAIL_MAX_LENGTH - domain.length - 1)}@${domain}`;
    expect(longest.length).toBe(CONTACT_EMAIL_MAX_LENGTH);
    // ローカル部が 64 文字を超えないよう、上の組み立てを確かめておく
    expect(longest.indexOf("@")).toBeLessThanOrEqual(64);
    expect(normalizeContactEmail(longest)).toEqual({ ok: true, value: longest });
    expect(normalizeContactEmail(`x${longest}`).ok).toBe(false);
    expect(normalizeContactEmail(`${"x".repeat(64)}@example.com`).ok).toBe(true);
    expect(normalizeContactEmail(`${"x".repeat(65)}@example.com`).ok).toBe(false);
  });

  it("エラー文言に入力値を含めない", () => {
    const result = normalizeContactEmail("secret-value@@example.com");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).not.toContain("secret-value");
  });
});

describe("contactEmailMailto", () => {
  it("ローカル部の「?」「#」「%」「&」を符号化し、件名などに化けさせない", () => {
    expect(contactEmailMailto("a@example.com")).toBe("mailto:a@example.com");
    expect(contactEmailMailto("a?b#c%d&e@example.com")).toBe("mailto:a%3Fb%23c%25d%26e@example.com");
  });
});

describe("omitContactEmail", () => {
  it("アドレスだけを外し、ほかの項目は残す", () => {
    const store = { id: "store_1", name: "導楽", contact_email: "a@example.com" };
    const omitted = omitContactEmail(store);
    expect(omitted).toEqual({ id: "store_1", name: "導楽" });
    expect("contact_email" in omitted).toBe(false);
    // 元のオブジェクトは変えない (キャッシュ済みの値を壊さない)
    expect(store.contact_email).toBe("a@example.com");
  });
});
