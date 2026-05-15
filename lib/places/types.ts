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
