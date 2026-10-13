import { describe, expect, it } from "vitest";
import { decodeHashId } from "../hash-id";

describe("decodeHashId", () => {
  it("先頭の # を外して id を返す", () => {
    expect(decodeHashId("#sales-assets")).toBe("sales-assets");
  });

  it("パーセントエンコードを解く", () => {
    expect(decodeHashId("#%E5%96%B6%E6%A5%AD")).toBe("営業");
  });

  it("空のハッシュは null", () => {
    expect(decodeHashId("")).toBeNull();
    expect(decodeHashId("#")).toBeNull();
  });

  it("不正なパーセントエンコードでも例外を投げず null を返す", () => {
    expect(() => decodeURIComponent("%")).toThrow(URIError);
    expect(decodeHashId("#%")).toBeNull();
    expect(decodeHashId("#%E0%A4%A")).toBeNull();
  });
});
