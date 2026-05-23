import { describe, expect, it } from "vitest";
import { applyParsedData, needsPlacesFallback, pickName } from "../apply";
import type { ApplyResult, OgpResult, ParsedUrl } from "../types";

function makeApplied(overrides: Partial<ApplyResult> = {}): ApplyResult {
  return {
    name: "",
    prefecture: "",
    city: "",
    phone: "",
    site_url: "",
    map_url: "",
    instagram_url: "",
    genre: "",
    address: "",
    review_avg: null,
    review_count: null,
    memo: "",
    operator_type: "未設定",
    operator_name: "",
    confidence: {},
    ...overrides,
  };
}

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

  // ==========================================================================
  // Phase 3.2: operator マージと信頼度同時セット(Req 1.3)
  // ==========================================================================

  describe("運営者(operator)のマージ", () => {
    const baseParsed: ParsedUrl = {
      type: "tabelog",
      source_url: "https://tabelog.com/x/y/z/1/",
      confidence: {},
    };

    it("ogp.operator が json_ld 由来なら operator_name と信頼度 90", () => {
      const ogp: OgpResult = {
        ok: true,
        name: "店舗A",
        operator: { value: "株式会社テスト", source: "json_ld" },
      };
      const result = applyParsedData(baseParsed, ogp);
      expect(result.operator_name).toBe("株式会社テスト");
      expect(result.confidence.operator_name).toBe(90);
    });

    it("ogp.operator が tabelog_dom 由来なら operator_name と信頼度 85", () => {
      const ogp: OgpResult = {
        ok: true,
        name: "店舗A",
        operator: { value: "山田太郎", source: "tabelog_dom" },
      };
      const result = applyParsedData(baseParsed, ogp);
      expect(result.operator_name).toBe("山田太郎");
      expect(result.confidence.operator_name).toBe(85);
    });

    it("operator_type は URL 解析だけでは判別不可のため常に '未設定' を維持", () => {
      const ogp: OgpResult = {
        ok: true,
        operator: { value: "株式会社テスト", source: "json_ld" },
      };
      const result = applyParsedData(baseParsed, ogp);
      expect(result.operator_type).toBe("未設定");
    });

    it("ogp.operator が undefined なら operator_name は空文字、信頼度なし", () => {
      const ogp: OgpResult = { ok: true, name: "店舗A" };
      const result = applyParsedData(baseParsed, ogp);
      expect(result.operator_name).toBe("");
      expect(result.confidence.operator_name).toBeUndefined();
    });

    it("ogp が null でも operator_name は空文字 + operator_type は未設定 (デフォルト)", () => {
      const result = applyParsedData(baseParsed, null);
      expect(result.operator_name).toBe("");
      expect(result.operator_type).toBe("未設定");
      expect(result.confidence.operator_name).toBeUndefined();
    });
  });
});

describe("needsPlacesFallback", () => {
  it("name が空のとき missing_name + query.keyword は parsed.name にフォールバック", () => {
    const parsed: ParsedUrl = {
      type: "google_maps",
      source_url: "https://www.google.com/maps/place/未取得",
      name: "未取得店舗",
      station_area: "渋谷",
      confidence: {},
    };
    const applied = makeApplied({ prefecture: "東京都" });
    const trigger = needsPlacesFallback(parsed, applied);
    expect(trigger.reason).toBe("missing_name");
    expect(trigger.query?.keyword).toBe("未取得店舗");
    expect(trigger.query?.area).toBe("東京都 渋谷");
  });

  it("name 信頼度 50 (GMAPS_QUERY) のとき low_name + クエリ構築", () => {
    const applied = makeApplied({
      name: "あいまい店",
      prefecture: "大阪府",
      city: "大阪市",
      confidence: { name: 50, prefecture: 95, city: 95 },
    });
    const trigger = needsPlacesFallback(null, applied);
    expect(trigger.reason).toBe("low_name");
    expect(trigger.query?.keyword).toBe("あいまい店");
    expect(trigger.query?.area).toBe("大阪府 大阪市");
  });

  it("prefecture=70 / city=70 のとき low_region", () => {
    const applied = makeApplied({
      name: "店舗A",
      prefecture: "?",
      city: "?",
      address: "?",
      confidence: { name: 90, prefecture: 70, city: 70 },
    });
    const trigger = needsPlacesFallback(null, applied);
    expect(trigger.reason).toBe("low_region");
  });

  it("address 空 + station_area あり のとき no_address (low_name より下位の優先順)", () => {
    const parsed: ParsedUrl = {
      type: "tabelog",
      source_url: "https://tabelog.com/x/y/z/1/",
      station_area: "新丸子",
      confidence: {},
    };
    const applied = makeApplied({
      name: "店舗A",
      prefecture: "神奈川県",
      address: "",
      confidence: { name: 90, prefecture: 95 },
    });
    const trigger = needsPlacesFallback(parsed, applied);
    expect(trigger.reason).toBe("no_address");
    expect(trigger.query?.area).toContain("新丸子");
  });

  it("全フィールド高信頼度 + address ありで none", () => {
    const applied = makeApplied({
      name: "店舗A",
      prefecture: "東京都",
      city: "渋谷区",
      address: "渋谷区道玄坂1-1-1",
      confidence: { name: 90, prefecture: 95, city: 95, address: 90 },
    });
    const trigger = needsPlacesFallback(null, applied);
    expect(trigger.reason).toBe("none");
    expect(trigger.query).toBeUndefined();
  });
});
