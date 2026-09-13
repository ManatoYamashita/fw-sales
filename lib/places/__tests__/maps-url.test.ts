/**
 * `buildPlaceIdMapsUrl` が Google Maps URLs の公式 Search 形式を生成することの検証。
 *
 * 公式仕様では Search action の `query` は **REQUIRED** であり、
 * `query_place_id` を使う場合も `query` と併記する必要がある。
 * `query_place_id` 単独の形式は公式に有効な Search URL として保証されていないため、
 * **新しく生成する URL** は必ず両方を持つ。
 * (過去に保存された `query` 無しの URL を入力として受理することとは別の話。
 *  その backward compatibility は `url-import-policy.test.ts` が固定する)
 */
import { describe, expect, it } from "vitest";
import { buildPlaceIdMapsUrl } from "../maps-url";

const PLACE_ID = "ChIJN1t_tDeuEmsRUsoyG83frY4";

/** 生成 URL の query parameter を、デコード済みの形で取り出す。 */
function params(url: string): URLSearchParams {
  return new URL(url).searchParams;
}

describe("buildPlaceIdMapsUrl", () => {
  it("Maps URLs の Search エンドポイントを使う", () => {
    const url = new URL(buildPlaceIdMapsUrl(PLACE_ID, "導楽"));
    expect(url.origin).toBe("https://www.google.com");
    expect(url.pathname).toBe("/maps/search/");
  });

  it("api=1 / query / query_place_id を必ず持つ", () => {
    const p = params(buildPlaceIdMapsUrl(PLACE_ID, "導楽"));
    expect(p.get("api")).toBe("1");
    // `query` は公式仕様で必須。欠けた URL を新規生成しない。
    expect(p.get("query")).toBe("導楽");
    expect(p.get("query_place_id")).toBe(PLACE_ID);
  });

  it("日本語の店舗名を正しく encode する", () => {
    const url = buildPlaceIdMapsUrl(PLACE_ID, "鮨処 なむら 本店");
    // 生の日本語・生の空白を URL へ埋め込まない。
    expect(url).not.toContain("鮨処");
    expect(url).not.toMatch(/query=[^&]* /);
    // デコードすれば元に戻る。
    expect(params(url).get("query")).toBe("鮨処 なむら 本店");
  });

  it.each([
    "A&B 食堂",
    "カフェ#1",
    "串カツ+田中",
    "Q=A バル",
    "100% 焼肉",
    "a?b/c",
  ])("記号を含む店舗名でも query parameter が壊れない: %s", (name) => {
    const url = buildPlaceIdMapsUrl(PLACE_ID, name);
    const p = params(url);
    expect(p.get("query")).toBe(name);
    // 店舗名の記号が別パラメータとして解釈されていないこと。
    expect(p.get("query_place_id")).toBe(PLACE_ID);
    expect([...p.keys()].sort()).toEqual(["api", "query", "query_place_id"]);
  });

  it("Place ID も query parameter として encode する (内部文字集合を仮定しない)", () => {
    const oddId = "ChIJ/a+b=c&d";
    const p = params(buildPlaceIdMapsUrl(oddId, "導楽"));
    expect(p.get("query_place_id")).toBe(oddId);
    expect([...p.keys()].sort()).toEqual(["api", "query", "query_place_id"]);
  });

  it("店舗名が空でも query を空にしない", () => {
    // `query` は必須なので、名前が無い Place では Place ID を検索語に使う。
    for (const empty of ["", "   "]) {
      const p = params(buildPlaceIdMapsUrl(PLACE_ID, empty));
      expect(p.get("query")).toBe(PLACE_ID);
      expect(p.get("query_place_id")).toBe(PLACE_ID);
    }
  });
});
