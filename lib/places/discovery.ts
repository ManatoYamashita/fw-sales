import type { AreaSearchDiscoveryInfo, AreaSearchDiscoverySource } from "./types";

/** 探索ソースの表示ラベル。店舗カードの「取得元」表示に使う。 */
export const AREA_SEARCH_DISCOVERY_SOURCE_LABELS: Record<AreaSearchDiscoverySource, string> = {
  mainTextSearch: "メイン検索",
  loadMore: "もっと読み込み",
  keywordExploration: "追加キーワード",
  centerExploration: "周辺地点探索",
  radiusExploration: "半径拡大",
};

/** 単一の探索ソースから discovery 情報を作成する。 */
export function createDiscoveryInfo(
  source: AreaSearchDiscoverySource,
): AreaSearchDiscoveryInfo {
  return { sources: [source], firstSource: source, sourceCount: 1 };
}

/**
 * 2つの discovery 情報を統合する。
 * - `sources` は重複を除いて `current` の後ろに `incoming` の新規分のみ追加する
 * - `firstSource` は `current` 側を維持する (先に見つかった探索を優先)
 * - 引数の `current`/`incoming` は変更しない
 */
export function mergeDiscoveryInfo(
  current: AreaSearchDiscoveryInfo,
  incoming: AreaSearchDiscoveryInfo,
): AreaSearchDiscoveryInfo {
  const sources = [...current.sources];
  for (const source of incoming.sources) {
    if (!sources.includes(source)) {
      sources.push(source);
    }
  }
  if (sources.length === current.sources.length) {
    return current;
  }
  return { sources, firstSource: current.firstSource, sourceCount: sources.length };
}

/** `discovery.sources` を画面表示用の文言に変換する (例: "メイン検索 + 追加キーワード")。 */
export function formatDiscoverySources(discovery: AreaSearchDiscoveryInfo): string {
  return discovery.sources
    .map((source) => AREA_SEARCH_DISCOVERY_SOURCE_LABELS[source])
    .join(" + ");
}
