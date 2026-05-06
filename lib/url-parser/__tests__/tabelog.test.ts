import { describe, expect, it } from "vitest";
import { parseTabelogUrl } from "../tabelog";

describe("parseTabelogUrl", () => {
  const URL = "https://tabelog.com/kanagawa/A1405/A140504/14096697/";

  it("URL から prefecture / city / station_area / store_id を抽出", () => {
    const result = parseTabelogUrl(URL);
    expect(result.type).toBe("tabelog");
    expect(result.prefecture).toBe("神奈川県");
    expect(result.city).toBe("川崎市");
    // station_area は subarea 由来
    expect(result.station_area).toBeDefined();
    expect(result.store_id).toBe("14096697");
    expect(result.tabelog_url).toBe(URL);
  });

  it("confidence: prefecture=high / city=medium", () => {
    const result = parseTabelogUrl(URL);
    expect(result.confidence.prefecture).toBe("high");
    expect(result.confidence.city).toBe("medium");
  });

  it("生のセグメント (pref_raw / area_raw / subarea_raw) を保持", () => {
    const result = parseTabelogUrl(URL);
    expect(result.pref_raw).toBe("kanagawa");
    expect(result.area_raw).toBe("A1405");
    expect(result.subarea_raw).toBe("A140504");
  });

  it("不正な URL でも落ちず、最小限の ParsedUrl を返す", () => {
    const result = parseTabelogUrl("https://tabelog.com/invalid");
    expect(result.type).toBe("tabelog");
    expect(result.tabelog_url).toBe("https://tabelog.com/invalid");
    expect(result.prefecture).toBeUndefined();
  });

  it("source_url と tabelog_url は同一の URL を保持", () => {
    const result = parseTabelogUrl(URL);
    expect(result.source_url).toBe(URL);
    expect(result.tabelog_url).toBe(URL);
  });
});
