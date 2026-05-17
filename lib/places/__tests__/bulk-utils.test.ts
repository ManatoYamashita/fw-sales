import { describe, expect, it } from "vitest";
import { deduplicatePlaceIds } from "../bulk-utils";

describe("deduplicatePlaceIds", () => {
  it("空配列は空配列を返す", () => {
    expect(deduplicatePlaceIds([])).toEqual([]);
  });

  it("重複した placeId を1件に絞る", () => {
    expect(deduplicatePlaceIds(["a", "b", "a", "c", "b"])).toEqual(["a", "b", "c"]);
  });

  it("空文字を除外する", () => {
    expect(deduplicatePlaceIds(["a", "", "b", ""])).toEqual(["a", "b"]);
  });

  it("全て重複の場合は1件にまとめる", () => {
    expect(deduplicatePlaceIds(["x", "x", "x"])).toEqual(["x"]);
  });

  it("重複なしの場合は順序を維持して全件返す", () => {
    expect(deduplicatePlaceIds(["c", "a", "b"])).toEqual(["c", "a", "b"]);
  });

  it("入力順を維持する (最初に出現した位置を保持)", () => {
    expect(deduplicatePlaceIds(["b", "a", "b", "c", "a"])).toEqual(["b", "a", "c"]);
  });
});
