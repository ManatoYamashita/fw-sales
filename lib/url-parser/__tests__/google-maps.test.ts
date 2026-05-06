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

  it("URL エンコードされた日本語 + /@coords + /data= 形式から name を抽出", () => {
    // 短縮 URL (maps.app.goo.gl) のリダイレクト後の長い形式
    const longUrl =
      "https://www.google.com/maps/place/neel%E4%B8%AD%E7%9B%AE%E9%BB%92/@35.6474266,139.6929246,16z/data=!3m1!4b1!4m6!3m5!1s0x60188bbea231b4e3:0x676d2a3186d43e9c!8m2!3d35.6474223!4d139.6955049!16s%2Fg%2F11k9chhrgz?entry=ttu";
    const result = parseGoogleMapsUrl(longUrl);
    // 「neel中目黒」が正しくデコードされ、@coords や data= は name に含まれない
    expect(result.name).toBe("neel中目黒");
    expect(result.confidence.name).toBe("medium");
  });
});
