import { describe, expect, it } from "vitest";
import { classifyPortal, isPortalHost, matchesDomain, PORTAL_DOMAINS, PORTAL_KINDS } from "../portal";

describe("matchesDomain", () => {
  it("完全一致する", () => {
    expect(matchesDomain("tabelog.com", "tabelog.com")).toBe(true);
  });

  it("サブドメインに一致する(dot boundary)", () => {
    expect(matchesDomain("s.tabelog.com", "tabelog.com")).toBe(true);
  });

  it("dot boundary を無視した string suffix 一致はしない(evil-example.com対策)", () => {
    expect(matchesDomain("evil-tabelog.com", "tabelog.com")).toBe(false);
    expect(matchesDomain("nottabelog.com", "tabelog.com")).toBe(false);
  });

  it("末尾に別ドメインを繋げたホストを誤判定しない(tabelog.com.evil.jp)", () => {
    expect(matchesDomain("tabelog.com.evil.jp", "tabelog.com")).toBe(false);
  });

  it("大文字小文字を無視する", () => {
    expect(matchesDomain("TABELOG.COM", "tabelog.com")).toBe(true);
  });
});

describe("classifyPortal", () => {
  it("既知のportalを正しく分類する", () => {
    expect(classifyPortal("tabelog.com")).toBe("tabelog");
    expect(classifyPortal("s.tabelog.com")).toBe("tabelog");
    expect(classifyPortal("hotpepper.jp")).toBe("hotpepper");
    expect(classifyPortal("gnavi.co.jp")).toBe("gnavi");
    expect(classifyPortal("retty.me")).toBe("retty");
    expect(classifyPortal("tablecheck.com")).toBe("tablecheck");
    expect(classifyPortal("ebica.jp")).toBe("ebica");
    expect(classifyPortal("ikyu.com")).toBe("ikyu");
    expect(classifyPortal("ozmall.co.jp")).toBe("ozmall");
    expect(classifyPortal("instagram.com")).toBe("instagram");
    expect(classifyPortal("facebook.com")).toBe("facebook");
    expect(classifyPortal("x.com")).toBe("x");
    expect(classifyPortal("twitter.com")).toBe("x");
    expect(classifyPortal("line.me")).toBe("line");
  });

  it("tabelog.com.evil.jp を portal と誤判定しない", () => {
    expect(classifyPortal("tabelog.com.evil.jp")).toBeNull();
    expect(isPortalHost("tabelog.com.evil.jp")).toBe(false);
  });

  it("非portalホストはnull", () => {
    expect(classifyPortal("example.com")).toBeNull();
    expect(isPortalHost("example.com")).toBe(false);
  });

  describe("google", () => {
    it("明示列挙されたGoogle系ホストのみを分類する(曖昧ワイルドカードを使わない)", () => {
      expect(classifyPortal("google.com")).toBe("google");
      expect(classifyPortal("google.co.jp")).toBe("google");
      expect(classifyPortal("goo.gl")).toBe("google");
      expect(classifyPortal("maps.app.goo.gl")).toBe("google");
      expect(classifyPortal("reserve.google.com")).toBe("google");
      expect(classifyPortal("business.site")).toBe("google");
    });

    it("google.com.evil.jp を誤判定しない", () => {
      expect(classifyPortal("google.com.evil.jp")).toBeNull();
    });

    it("列挙外の国別TLD(google.de等)はV1では非portal", () => {
      expect(classifyPortal("google.de")).toBeNull();
    });
  });

  it("PORTAL_KINDS は PORTAL_DOMAINS のキーと一致する", () => {
    expect([...PORTAL_KINDS].sort()).toEqual(Object.keys(PORTAL_DOMAINS).sort());
  });
});
