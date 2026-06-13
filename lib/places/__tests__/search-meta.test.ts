import { describe, expect, it } from "vitest";
import { buildTextSearchMeta, getAreaSearchMetaMessages } from "../search-meta";

describe("buildTextSearchMeta", () => {
  it("loadedCount=20, hasNextPage=true のとき 最大60件・もっと読み込み可能になる", () => {
    const meta = buildTextSearchMeta({
      loadedCount: 20,
      hasNextPage: true,
      currentPageCount: 1,
      apiCallEstimate: 2,
    });

    expect(meta.maxResults).toBe(60);
    expect(meta.loadedCount).toBe(20);
    expect(meta.hasNextPage).toBe(true);
  });

  it("loadedCount=60, hasNextPage=false のとき 最大到達/もっと読み込み不可になる", () => {
    const meta = buildTextSearchMeta({
      loadedCount: 60,
      hasNextPage: false,
      currentPageCount: 3,
      apiCallEstimate: 4,
    });

    expect(meta.maxResults).toBe(60);
    expect(meta.loadedCount).toBe(60);
    expect(meta.hasNextPage).toBe(false);
  });

  it("apiCallEstimate が渡した値で保持される", () => {
    const meta = buildTextSearchMeta({
      loadedCount: 20,
      hasNextPage: true,
      currentPageCount: 1,
      apiCallEstimate: 2,
    });

    expect(meta.apiCallEstimate).toBe(2);

    const metaOnePage = buildTextSearchMeta({
      loadedCount: 20,
      hasNextPage: true,
      currentPageCount: 1,
      apiCallEstimate: 1,
    });
    expect(metaOnePage.apiCallEstimate).toBe(1);
  });

  it("source/provider/rankBasis/locationMode は固定値になる", () => {
    const meta = buildTextSearchMeta({
      loadedCount: 20,
      hasNextPage: true,
      currentPageCount: 1,
      apiCallEstimate: 2,
    });

    expect(meta.source).toBe("textSearch");
    expect(meta.provider).toBe("googlePlaces");
    expect(meta.rankBasis).toBe("googleTextRelevance");
    expect(meta.locationMode).toBe("locationBias");
    expect(meta.requestedPageSize).toBe(20);
    expect(meta.maxPages).toBe(3);
  });
});

describe("getAreaSearchMetaMessages", () => {
  it("Text Search / 最大60件 / locationBias の説明を返す", () => {
    const meta = buildTextSearchMeta({
      loadedCount: 20,
      hasNextPage: true,
      currentPageCount: 1,
      apiCallEstimate: 2,
    });

    const messages = getAreaSearchMetaMessages(meta);

    expect(messages.some((m) => m.includes("Text Search"))).toBe(true);
    expect(messages.some((m) => m.includes("60"))).toBe(true);
    expect(messages.some((m) => m.includes("locationBias"))).toBe(true);
    expect(messages.some((m) => m.includes("もっと読み込み: 可能"))).toBe(true);
    expect(messages.some((m) => m.includes("API呼び出し回数目安: 2回"))).toBe(true);
  });

  it("hasNextPage=false の場合は読み込み不可とさらに探索を促す文言になる", () => {
    const meta = buildTextSearchMeta({
      loadedCount: 60,
      hasNextPage: false,
      currentPageCount: 3,
      apiCallEstimate: 4,
    });

    const messages = getAreaSearchMetaMessages(meta);

    expect(messages.some((m) => m.includes("もっと読み込み: できません"))).toBe(true);
    expect(messages.some((m) => m.includes("追加探索"))).toBe(true);
  });

  it("追加探索が混ざっても誤解を生まない文言になっている (メイン検索の取得元と明示)", () => {
    const meta = buildTextSearchMeta({
      loadedCount: 35,
      hasNextPage: true,
      currentPageCount: 2,
      apiCallEstimate: 4,
    });

    const messages = getAreaSearchMetaMessages(meta);

    // 「全候補がText Search初回のみ」と誤解させない: 「メイン検索の」と明示する
    expect(messages.some((m) => m.includes("メイン検索の取得元"))).toBe(true);
    // 「全件」「すべて」のような誤解を招く断定表現は含めない
    expect(messages.every((m) => !m.includes("全件はText Search"))).toBe(true);
  });
});
