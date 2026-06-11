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
 * エリア検索結果1件分の表示用ViewModel。
 * `PlaceWithMatch` に、中心地点からの距離・半径内外判定を付与したもの。
 * DB保存用の型 (`PlaceResult`/`PlaceWithMatch`) には混ぜず、表示専用として扱う。
 */
export type AreaSearchPlaceViewModel = PlaceWithMatch & {
  /** 中心地点からの距離 (メートル) */
  distanceMeters: number;
  /** 中心地点から指定半径内かどうか (`distanceMeters <= radiusMeters`) */
  isWithinRadius: boolean;
};

/** エリア検索Action (`searchPlacesWithMatchesAction`) の戻り値データ部。 */
export interface AreaSearchResultPayload {
  places: AreaSearchPlaceViewModel[];
  nextPageToken: string | null;
  /** 検索に使用した中心地点 (「もっと読み込む」時に再利用する) */
  center: SearchCenter;
  /** 検索に使用した半径 (メートル) */
  radiusMeters: number;
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
