import { SEARCH_RESULT_SOFT_LIMIT } from "./exploration";
import type { AreaSearchMeta } from "./types";

/** Google Places Text Search 1ページあたりのリクエスト件数 (`searchPlacesPage` の既定 `pageSize`)。 */
export const TEXT_SEARCH_PAGE_SIZE = 20;

/**
 * Text Search 1回の呼び出し (1ページ分) のメタ情報を組み立てる。
 *
 * `requestedPageSize`/`maxPages`/`maxResults`/`source`/`provider`/`rankBasis`/
 * `locationMode` は固定値 (Text Search + locationBias 前提) で、呼び出し側ごとに
 * 変わる `loadedCount`/`hasNextPage`/`currentPageCount`/`apiCallEstimate` のみを
 * パラメータとして受け取る。
 */
export function buildTextSearchMeta(params: {
  loadedCount: number;
  hasNextPage: boolean;
  currentPageCount: number;
  apiCallEstimate: number;
}): AreaSearchMeta {
  return {
    source: "textSearch",
    provider: "googlePlaces",
    requestedPageSize: TEXT_SEARCH_PAGE_SIZE,
    maxPages: SEARCH_RESULT_SOFT_LIMIT / TEXT_SEARCH_PAGE_SIZE,
    maxResults: SEARCH_RESULT_SOFT_LIMIT,
    currentPageCount: params.currentPageCount,
    loadedCount: params.loadedCount,
    hasNextPage: params.hasNextPage,
    apiCallEstimate: params.apiCallEstimate,
    rankBasis: "googleTextRelevance",
    locationMode: "locationBias",
  };
}

/**
 * 検索状況メタ情報をUI表示用の説明文に変換する。
 * 「Text Searchの結果である」「最大60件である」「locationBiasのため範囲外候補を含み得る」
 * 「API回数目安」をユーザーに伝える (Issue #129 follow-up: 探索の説明責任)。
 */
export function getAreaSearchMetaMessages(meta: AreaSearchMeta): string[] {
  return [
    "メイン検索の取得元: Google Text Search (Googleおすすめ順は距離順ではなく関連度順です)",
    `現在 ${meta.loadedCount.toLocaleString()}件 / 最大${meta.maxResults.toLocaleString()}件`,
    meta.hasNextPage
      ? "もっと読み込み: 可能"
      : `もっと読み込み: できません (最大${meta.maxResults}件まで取得済み。別キーワード・周辺地点・半径拡大で追加探索してください)`,
    "半径はlocationBiasのため、範囲外候補が含まれる場合があります",
    `API呼び出し回数目安: ${meta.apiCallEstimate.toLocaleString()}回`,
  ];
}
