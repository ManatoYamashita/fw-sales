import { describe, expect, it } from "vitest";
import { hasInstagramReference, primaryInstagramUrl, instagramUsernameFromUrl } from "../instagram";

describe("hasInstagramReference", () => {
  it("リンクが1件以上あればtrue", () => {
    expect(hasInstagramReference(["https://instagram.com/store"])).toBe(true);
  });

  it("空配列はfalse", () => {
    expect(hasInstagramReference([])).toBe(false);
  });
});

describe("primaryInstagramUrl", () => {
  it("先頭のリンクを返す", () => {
    expect(primaryInstagramUrl(["https://instagram.com/a", "https://instagram.com/b"])).toBe(
      "https://instagram.com/a",
    );
  });

  it("空配列はnull", () => {
    expect(primaryInstagramUrl([])).toBeNull();
  });
});

describe("instagramUsernameFromUrl", () => {
  it("path第1セグメントをusernameとする", () => {
    expect(instagramUsernameFromUrl("https://instagram.com/my_store")).toBe("my_store");
  });

  it("予約語(投稿/リール等)はusernameとして扱わない", () => {
    for (const seg of ["p", "reel", "reels", "explore", "stories", "tv", "accounts", "direct"]) {
      expect(instagramUsernameFromUrl(`https://instagram.com/${seg}/12345`)).toBeNull();
    }
  });

  it("大文字小文字を無視して予約語判定する", () => {
    expect(instagramUsernameFromUrl("https://instagram.com/P/12345")).toBeNull();
  });

  it("pathが空ならnull", () => {
    expect(instagramUsernameFromUrl("https://instagram.com/")).toBeNull();
  });

  it("パース不能なURLはnull", () => {
    expect(instagramUsernameFromUrl("not a url")).toBeNull();
  });
});
