import { describe, expect, it } from "vitest";
import { parseGoogleMapsUrl } from "../google-maps";

describe("parseGoogleMapsUrl", () => {
  it("/maps/place/<name>/ 形式から name を抽出", () => {
    const result = parseGoogleMapsUrl(
      "https://www.google.com/maps/place/導楽",
    );
    expect(result.type).toBe("google_maps");
    expect(result.name).toBe("導楽");
    expect(result.confidence.name).toBe("medium");
    expect(result.map_url).toBe("https://www.google.com/maps/place/導楽");
  });

  it("URL エンコードされた + 区切り(空白の代替)を空白に戻す", () => {
    const result = parseGoogleMapsUrl(
      "https://www.google.com/maps/place/トラットリア+SOLE",
    );
    expect(result.name).toBe("トラットリア SOLE");
  });

  it("?q= クエリパラメータからの抽出は low confidence", () => {
    const result = parseGoogleMapsUrl(
      "https://www.google.com/maps?q=導楽+新丸子",
    );
    expect(result.name).toBe("導楽 新丸子");
    expect(result.confidence.name).toBe("low");
  });

  it("place 部分が data= プレフィックスのときは name を抽出しない", () => {
    const result = parseGoogleMapsUrl(
      "https://www.google.com/maps/place/data=!4m...",
    );
    expect(result.name).toBeUndefined();
  });

  it("source_url と map_url は元 URL を保持", () => {
    const url = "https://maps.google.com/?q=test";
    const result = parseGoogleMapsUrl(url);
    expect(result.source_url).toBe(url);
    expect(result.map_url).toBe(url);
  });

  it("name 由来でジャンル推定が走る場合がある", () => {
    const result = parseGoogleMapsUrl(
      "https://www.google.com/maps/place/居酒屋+導楽",
    );
    expect(result.name).toBe("居酒屋 導楽");
    expect(result.genre).toBeDefined(); // 「居酒屋」キーワードでジャンル推定
  });
});
