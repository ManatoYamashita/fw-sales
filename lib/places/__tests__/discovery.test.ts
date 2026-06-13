import { describe, expect, it } from "vitest";
import {
  createDiscoveryInfo,
  formatDiscoverySources,
  mergeDiscoveryInfo,
} from "../discovery";
import type { AreaSearchDiscoveryInfo } from "../types";

describe("createDiscoveryInfo", () => {
  it("単一ソースから sources/firstSource/sourceCount=1 を作成する", () => {
    expect(createDiscoveryInfo("mainTextSearch")).toEqual({
      sources: ["mainTextSearch"],
      firstSource: "mainTextSearch",
      sourceCount: 1,
    });
  });
});

describe("mergeDiscoveryInfo", () => {
  it("同一ソースのみの場合は sources が増えない (current を返す)", () => {
    const current = createDiscoveryInfo("mainTextSearch");
    const incoming = createDiscoveryInfo("mainTextSearch");

    const result = mergeDiscoveryInfo(current, incoming);

    expect(result).toBe(current);
    expect(result.sources).toEqual(["mainTextSearch"]);
    expect(result.sourceCount).toBe(1);
  });

  it("新しいソースは current の後ろに追加される", () => {
    const current = createDiscoveryInfo("mainTextSearch");
    const incoming = createDiscoveryInfo("keywordExploration");

    const result = mergeDiscoveryInfo(current, incoming);

    expect(result.sources).toEqual(["mainTextSearch", "keywordExploration"]);
    expect(result.sourceCount).toBe(2);
  });

  it("firstSource は current 側を維持する", () => {
    const current = createDiscoveryInfo("mainTextSearch");
    const incoming = createDiscoveryInfo("radiusExploration");

    const result = mergeDiscoveryInfo(current, incoming);

    expect(result.firstSource).toBe("mainTextSearch");
  });

  it("sources は重複しない (3つ目以降のソースも重複除去される)", () => {
    const current: AreaSearchDiscoveryInfo = {
      sources: ["mainTextSearch", "keywordExploration"],
      firstSource: "mainTextSearch",
      sourceCount: 2,
    };
    const incoming: AreaSearchDiscoveryInfo = {
      sources: ["keywordExploration", "centerExploration"],
      firstSource: "keywordExploration",
      sourceCount: 2,
    };

    const result = mergeDiscoveryInfo(current, incoming);

    expect(result.sources).toEqual([
      "mainTextSearch",
      "keywordExploration",
      "centerExploration",
    ]);
    expect(result.sourceCount).toBe(3);
  });

  it("current/incoming の元オブジェクトを変更しない", () => {
    const current = createDiscoveryInfo("mainTextSearch");
    const incoming = createDiscoveryInfo("keywordExploration");
    const currentSnapshot = { ...current, sources: [...current.sources] };
    const incomingSnapshot = { ...incoming, sources: [...incoming.sources] };

    mergeDiscoveryInfo(current, incoming);

    expect(current).toEqual(currentSnapshot);
    expect(incoming).toEqual(incomingSnapshot);
  });
});

describe("formatDiscoverySources", () => {
  it("単一ソースはそのままラベルを返す", () => {
    expect(formatDiscoverySources(createDiscoveryInfo("mainTextSearch"))).toBe(
      "メイン検索",
    );
  });

  it("複数ソースは ' + ' で連結する", () => {
    const discovery: AreaSearchDiscoveryInfo = {
      sources: ["keywordExploration", "radiusExploration"],
      firstSource: "keywordExploration",
      sourceCount: 2,
    };
    expect(formatDiscoverySources(discovery)).toBe("追加キーワード + 半径拡大");
  });

  it("nearbyExploration は「Nearby深掘り」を返す", () => {
    expect(formatDiscoverySources(createDiscoveryInfo("nearbyExploration"))).toBe(
      "Nearby深掘り",
    );
  });
});
