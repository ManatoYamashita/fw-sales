/** DBに既存の店舗が見つかった場合に返す最小限の情報 */
export type MatchedStoreSummary = {
  id: string;
  name: string;
};

/** 検索結果1件 + DB照合結果を組み合わせた型 */
export type PlaceWithMatch = {
  place: PlaceResult;
  /** DB登録済みの場合は { id, name }。未登録の場合は null。 */
  matchedStore: MatchedStoreSummary | null;
};

/**
 * Google Places Text Search 1ページ分の結果。
 * `nextPageToken` は次ページが存在する場合のトークン、存在しない場合は null。
 */
export interface PlaceSearchPage {
  places: PlaceResult[];
  nextPageToken: string | null;
}

/** エリア検索の中心地点 (緯度経度)。`resolveSearchCenter` で解決した結果。 */
export interface SearchCenter {
  lat: number;
  lng: number;
}

/**
 * 店舗が見つかった探索の種類。
 * - `mainTextSearch`: 初回検索 (Text Search 1ページ目)
 * - `loadMore`: 「もっと読み込む」(同条件の次ページ)
 * - `keywordExploration`: 別キーワードでの追加探索
 * - `centerExploration`: 周辺地点での追加探索
 * - `radiusExploration`: 半径拡大での追加探索
 * - `nearbyExploration`: Nearby Searchによる手動の深掘り探索
 */
export type AreaSearchDiscoverySource =
  | "mainTextSearch"
  | "loadMore"
  | "keywordExploration"
  | "centerExploration"
  | "radiusExploration"
  | "nearbyExploration";

/**
 * 店舗ごとの探索ソース情報。
 * 同じ店舗が複数の探索で見つかった場合は `sources` に統合される。
 */
export interface AreaSearchDiscoveryInfo {
  /** この店舗が見つかった探索の一覧 (重複なし、見つかった順)。 */
  sources: AreaSearchDiscoverySource[];
  /** 最初に見つかった探索。 */
  firstSource: AreaSearchDiscoverySource;
  /** `sources.length` (見つかった探索の種類数)。 */
  sourceCount: number;
}

/**
 * エリア検索結果1件分の表示用ViewModel。
 * `PlaceWithMatch` に、中心地点からの距離・半径内外判定・探索ソース情報を付与したもの。
 * DB保存用の型 (`PlaceResult`/`PlaceWithMatch`) には混ぜず、表示専用として扱う。
 */
export type AreaSearchPlaceViewModel = PlaceWithMatch & {
  /** 中心地点からの距離 (メートル) */
  distanceMeters: number;
  /** 中心地点から指定半径内かどうか (`distanceMeters <= radiusMeters`) */
  isWithinRadius: boolean;
  /** この店舗が見つかった探索ソース情報。 */
  discovery: AreaSearchDiscoveryInfo;
  /** Place Detailsオンデマンド取得で得たWebサイトURL。未取得の場合は undefined。 */
  websiteUri?: string | null;
  /** Place Detailsオンデマンド取得で得た営業状態 (例: "OPERATIONAL")。未取得の場合は undefined。 */
  businessStatus?: string | null;
};

/**
 * エリア検索1回の呼び出し (Text Search 1ページ分) に関するメタ情報。
 * 「探索の説明責任」と「コスト管理の土台」用 (Issue #129 follow-up)。
 * UI側はこれを使って「取得元」「上限件数」「もっと読み込み可否」「API回数目安」等を表示する。
 */
export interface AreaSearchMeta {
  /** 検索結果の取得方法。現状は Text Search のみ。 */
  source: "textSearch";
  /** 検索プロバイダ。現状は Google Places のみ。 */
  provider: "googlePlaces";
  /** Text Search 1ページあたりのリクエスト件数 (`pageSize`)。 */
  requestedPageSize: number;
  /** `maxResults / requestedPageSize` のページ数上限。 */
  maxPages: number;
  /** Text Search で取得可能な最大件数 (= `SEARCH_RESULT_SOFT_LIMIT`)。 */
  maxResults: number;
  /** この呼び出しで取得したページ数 (常に1)。 */
  currentPageCount: number;
  /** この呼び出し時点での読み込み済み件数。 */
  loadedCount: number;
  /** 次ページが存在するか (`nextPageToken !== null`)。 */
  hasNextPage: boolean;
  /**
   * この呼び出しでAPIを呼ぶ想定回数の目安 (厳密な課金額ではない)。
   * 初回検索: resolveSearchCenter + searchPlacesPage = 2、
   * `options.center` 指定の「もっと読み込む」: searchPlacesPage のみ = 1。
   */
  apiCallEstimate: number;
  /** 並び順の基準。Text Search のデフォルトは関連度順 (距離順ではない)。 */
  rankBasis: "googleTextRelevance";
  /** 範囲指定の方式。`locationBias` は厳密な範囲制限ではないため範囲外候補を含み得る。 */
  locationMode: "locationBias";
}

/** エリア検索Action (`searchPlacesWithMatchesAction`) の戻り値データ部。 */
export interface AreaSearchResultPayload {
  places: AreaSearchPlaceViewModel[];
  nextPageToken: string | null;
  /** 検索に使用した中心地点 (「もっと読み込む」時に再利用する) */
  center: SearchCenter;
  /** 検索に使用した半径 (メートル) */
  radiusMeters: number;
  /** この呼び出しに関するメタ情報 (取得元・上限件数・API回数目安など) */
  meta: AreaSearchMeta;
}

/**
 * Place Details のオンデマンド取得結果1件分。
 * Nearby Search等では取得しない電話番号・Webサイト・評価・口コミ数・営業状態を含む。
 */
export interface PlaceDetailsResult {
  /** places.id (例: "ChIJ...") */
  placeId: string;
  /** places.displayName.text */
  name: string;
  /** places.formattedAddress (日本語住所フル形式) */
  address: string;
  /** places.location.latitude */
  lat: number;
  /** places.location.longitude */
  lng: number;
  /** places.googleMapsUri。取得できない場合は空文字。 */
  googleMapsUri: string;
  /** places.types (英語タグ配列)。例: ["restaurant", "food", "establishment"] */
  types: string[];
  /** places.nationalPhoneNumber。未取得時は空文字。 */
  phone: string;
  /** places.rating。未評価の場合は null。 */
  rating: number | null;
  /** places.userRatingCount。未評価の場合は null。 */
  userRatingsTotal: number | null;
  /** places.websiteUri。取得できない場合は null。 */
  websiteUri: string | null;
  /** places.businessStatus (例: "OPERATIONAL")。取得できない場合は null。 */
  businessStatus: string | null;
}

/** Google Places API New (v2) Text Search の検索結果 1件分 */
export interface PlaceResult {
  /** places.id (例: "ChIJ...") */
  placeId: string;
  /** places.displayName.text */
  name: string;
  /** places.formattedAddress (日本語住所フル形式) */
  formattedAddress: string;
  /** places.location.latitude */
  lat: number;
  /** places.location.longitude */
  lng: number;
  /** places.nationalPhoneNumber。未取得時は空文字。 */
  phone: string;
  /** places.rating。未評価の場合は null。 */
  rating: number | null;
  /** places.userRatingCount。未評価の場合は null。 */
  userRatingsTotal: number | null;
  /** places.types (英語タグ配列)。例: ["restaurant", "food", "establishment"] */
  types: string[];
  /** places.googleMapsUri。取得できない場合は null。 */
  googleMapsUri: string | null;
}
