/**
 * Google Maps JavaScript API の最小限の型定義。
 * `@types/google.maps` は導入せず、`area-search-map.tsx` で使用する範囲のみを
 * アンビエント宣言する (動的に読み込む `<script>` 経由のグローバル `google` を型付け)。
 */
declare namespace google {
  namespace maps {
    interface LatLngLiteral {
      lat: number;
      lng: number;
    }

    interface MapOptions {
      center?: LatLngLiteral;
      zoom?: number;
      disableDefaultUI?: boolean;
      zoomControl?: boolean;
      gestureHandling?: string;
    }

    class Map {
      constructor(el: HTMLElement, opts?: MapOptions);
      setCenter(latLng: LatLngLiteral): void;
      setZoom(zoom: number): void;
    }

    enum SymbolPath {
      CIRCLE = 0,
    }

    interface Symbol {
      path: SymbolPath;
      scale?: number;
      fillColor?: string;
      fillOpacity?: number;
      strokeColor?: string;
      strokeWeight?: number;
    }

    interface MarkerOptions {
      position: LatLngLiteral;
      map?: Map | null;
      title?: string;
      icon?: Symbol;
      zIndex?: number;
    }

    interface MapsEventListener {
      remove(): void;
    }

    class Marker {
      constructor(opts?: MarkerOptions);
      setMap(map: Map | null): void;
      setPosition(latLng: LatLngLiteral): void;
      setIcon(icon: Symbol): void;
      setZIndex(zIndex: number): void;
      addListener(eventName: string, handler: () => void): MapsEventListener;
    }

    interface CircleOptions {
      center?: LatLngLiteral;
      radius?: number;
      map?: Map | null;
      strokeColor?: string;
      strokeOpacity?: number;
      strokeWeight?: number;
      fillColor?: string;
      fillOpacity?: number;
    }

    class Circle {
      constructor(opts?: CircleOptions);
      setMap(map: Map | null): void;
      setCenter(latLng: LatLngLiteral): void;
      setRadius(radius: number): void;
    }
  }
}

interface Window {
  google?: typeof google;
  __areaSearchGoogleMapsLoaded?: () => void;
}
