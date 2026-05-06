import { describe, expect, it } from "vitest";
import { applyParsedData, pickName } from "../apply";
import type { OgpResult, ParsedUrl } from "../types";

describe("pickName", () => {
  describe("Google Maps URL のとき URL 由来の name を優先 (P0 リグレッション防止)", () => {
    it("OGP が 'Google マップ' でも parsed.name を採用", () => {
      const r = pickName("導楽", "Google マップ", "google_maps");
      expect(r.value).toBe("導楽");
      expect(r.source).toBe("parsed");
    });

    it("OGP が 'Google Maps' でも parsed.name を採用", () => {
      const r = pickName("トラットリア SOLE", "Google Maps", "google_maps");
      expect(r.value).toBe("トラットリア SOLE");
      expect(r.source).toBe("parsed");
    });

    it("OGP が 'Googleマップ' (空白なし) でも parsed.name を採用", () => {
      const r = pickName("導楽", "Googleマップ", "google_maps");
      expect(r.value).toBe("導楽");
      expect(r.source).toBe("parsed");
    });

    it("parsed.name が空のとき OGP のクリーンな値があればそれを採用", () => {
      const r = pickName(undefined, "クリーン店舗", "google_maps");
      expect(r.value).toBe("クリーン店舗");
      expect(r.source).toBe("ogp");
    });

    it("parsed.name が空 + OGP がブラックリストのとき空文字を返す", () => {
      const r = pickName(undefined, "Google マップ", "google_maps");
      expect(r.value).toBe("");
      expect(r.source).toBe("none");
    });
  });

  describe("食べログ等で OGP > parsed", () => {
    it("両方値がある場合 OGP を優先", () => {
      const r = pickName("導楽", "導楽 新丸子店", "tabelog");
      expect(r.value).toBe("導楽 新丸子店");
      expect(r.source).toBe("ogp");
    });

    it("OGP が '食べログ' (ブラックリスト) なら parsed にフォールバック", () => {
      const r = pickName("導楽", "食べログ", "tabelog");
      expect(r.value).toBe("導楽");
      expect(r.source).toBe("parsed");
    });

    it("OGP が空白のみなら parsed にフォールバック", () => {
      const r = pickName("導楽", "   ", "tabelog");
      expect(r.value).toBe("導楽");
      expect(r.source).toBe("parsed");
    });
  });

  it("両方とも空なら空文字 + source=none", () => {
    const r = pickName(undefined, undefined, "unknown");
    expect(r.value).toBe("");
    expect(r.source).toBe("none");
  });
});

describe("applyParsedData (P0 統合シナリオ)", () => {
  const baseConfidence = { name: "medium" as const, prefecture: "high" as const };

  it("Google Maps URL: OGP の汚染値で parsed.name を上書きしない", () => {
    const parsed: ParsedUrl = {
      type: "google_maps",
      source_url: "https://www.google.com/maps/place/導楽",
      name: "導楽",
      map_url: "https://www.google.com/maps/place/導楽",
      confidence: { name: "medium" },
    };
    const ogp: OgpResult = {
      ok: true,
      name: "Google マップ", // 汚染源
    };
    const result = applyParsedData(parsed, ogp);
    expect(result.name).toBe("導楽"); // P0 修正: "Google マップ" にならない
    expect(typeof result.confidence.name).toBe("number");
  });

  it("食べログ URL: OGP の正しい店名を採用", () => {
    const parsed: ParsedUrl = {
      type: "tabelog",
      source_url: "https://tabelog.com/kanagawa/A1405/A140504/14096697/",
      prefecture: "神奈川県",
      city: "川崎市",
      station_area: "新丸子",
      tabelog_url: "https://tabelog.com/kanagawa/A1405/A140504/14096697/",
      confidence: { ...baseConfidence, city: "medium" },
    };
    const ogp: OgpResult = {
      ok: true,
      name: "導楽",
      address: "〒2110004 神奈川県 川崎市中原区 新丸子東1-983",
      phone: "044-750-9977",
      rating: 3.4,
      review_count: 12,
    };
    const result = applyParsedData(parsed, ogp);
    expect(result.name).toBe("導楽");
    expect(result.prefecture).toBe("神奈川県");
    expect(result.city).toBe("川崎市");
    expect(result.address).toBe("〒2110004 神奈川県 川崎市中原区 新丸子東1-983"); // JSON-LD 由来優先
    expect(result.phone).toBe("044-750-9977");
    expect(result.review_avg).toBe(3.4);
    expect(result.review_count).toBe(12);
  });

  it("食べログ URL で OGP に詳細住所がない場合 station_area + 周辺 にフォールバック", () => {
    const parsed: ParsedUrl = {
      type: "tabelog",
      source_url: "https://tabelog.com/kanagawa/A1405/A140504/14096697/",
      prefecture: "神奈川県",
      station_area: "新丸子",
      tabelog_url: "https://tabelog.com/kanagawa/A1405/A140504/14096697/",
      confidence: { prefecture: "high" },
    };
    const ogp: OgpResult = { ok: true, name: "導楽" };
    const result = applyParsedData(parsed, ogp);
    expect(result.address).toBe("新丸子周辺");
  });

  it("confidence が各フィールドに数値で記録される", () => {
    const parsed: ParsedUrl = {
      type: "tabelog",
      source_url: "https://tabelog.com/kanagawa/A1405/A140504/14096697/",
      prefecture: "神奈川県",
      city: "川崎市",
      confidence: { prefecture: "high", city: "medium" },
    };
    const ogp: OgpResult = { ok: true, name: "導楽", phone: "044-750-9977" };
    const result = applyParsedData(parsed, ogp);
    expect(result.confidence.prefecture).toBe(95); // high → TABELOG_DICT
    expect(result.confidence.city).toBe(75); // medium → OGP_TITLE
    expect(typeof result.confidence.phone).toBe("number");
    expect(typeof result.confidence.name).toBe("number");
  });

  it("ogp.site_url を ApplyResult に反映", () => {
    const parsed: ParsedUrl = {
      type: "tabelog",
      source_url: "https://tabelog.com/x/y/z/1/",
      confidence: {},
    };
    const ogp: OgpResult = {
      ok: true,
      name: "店舗 A",
      site_url: "https://example.com",
    };
    const result = applyParsedData(parsed, ogp);
    expect(result.site_url).toBe("https://example.com");
    expect(result.confidence.site_url).toBeDefined();
  });
});
