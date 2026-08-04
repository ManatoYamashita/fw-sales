import { describe, expect, it } from "vitest";
import { resolveRootCandidate, type StoreUrlSource } from "../resolve-candidates";

describe("resolveRootCandidate", () => {
  it("有効な site_url を候補にする", () => {
    const result = resolveRootCandidate({ site_url: "https://example.com/" });
    expect(result).toEqual({ ok: true, url: "https://example.com/" });
  });

  it("空文字(CC-2: 未設定は null ではなく空文字)を候補にしない", () => {
    expect(resolveRootCandidate({ site_url: "" })).toEqual({ ok: false, reason: "empty" });
    expect(resolveRootCandidate({ site_url: "   " })).toEqual({ ok: false, reason: "empty" });
  });

  it("不正なURLを候補にしない", () => {
    expect(resolveRootCandidate({ site_url: "not a url" }).ok).toBe(false);
  });

  it("portal(Tabelog等)を候補にしない", () => {
    const result = resolveRootCandidate({ site_url: "https://tabelog.com/tokyo/A1301/A130101/12345678/" });
    expect(result).toEqual({ ok: false, reason: "portal_host" });
  });

  it("basic_info を一切参照しない(CC-1): 読み取りだけで例外を投げるオブジェクトでも動作する", () => {
    const store = {
      site_url: "https://example.com/",
      get basic_info(): never {
        throw new Error("basic_info should never be read by resolveRootCandidate");
      },
    };
    expect(() => resolveRootCandidate(store as unknown as StoreUrlSource)).not.toThrow();
    expect(resolveRootCandidate(store as unknown as StoreUrlSource)).toEqual({
      ok: true,
      url: "https://example.com/",
    });
  });

});
