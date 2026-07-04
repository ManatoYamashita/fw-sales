"use client";

import { useEffect, useRef, useState } from "react";
import { Spinner } from "@/components/ui/spinner";
import type { AreaSearchPlaceViewModel, SearchCenter } from "@/lib/places/types";
import { markerColorFor, zoomForRadius } from "@/lib/places/area-search-map-utils";

export interface AreaSearchMapProps {
  center: SearchCenter;
  radiusMeters: number;
  places: readonly AreaSearchPlaceViewModel[];
  addedIds: ReadonlySet<string>;
  activePlaceId: string | null;
  onActivatePlace: (placeId: string | null) => void;
  /** ピン明示クリック時に発火 (ホバー連動とは別経路)。
      一覧側で対応カードへスクロール+ハイライトするのに使う。 */
  onPinClick?: (placeId: string) => void;
}

const SCRIPT_ID = "area-search-google-maps-script";
const CALLBACK_NAME = "__areaSearchGoogleMapsLoaded";

// 複数の AreaSearchMap インスタンスが同時にマウントされても script タグを
// 1つだけ追加するよう、モジュールスコープで読み込み Promise を共有する。
// 読み込み失敗時は null に戻し、再試行できるようにする。
let googleMapsScriptPromise: Promise<void> | null = null;

function loadGoogleMapsScript(apiKey: string): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("window is not available"));
  }
  if (window.google?.maps?.Map) {
    return Promise.resolve();
  }
  if (googleMapsScriptPromise) {
    return googleMapsScriptPromise;
  }

  googleMapsScriptPromise = new Promise<void>((resolve, reject) => {
    window[CALLBACK_NAME] = () => resolve();

    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
      apiKey,
    )}&v=weekly&loading=async&callback=${CALLBACK_NAME}`;
    script.async = true;
    // Google Maps の HTTP referrer キー制限には origin だけで十分なため、
    // full path を送らない近代既定 (origin のみ送出) を明示する。
    script.referrerPolicy = "strict-origin-when-cross-origin";
    script.onerror = () =>
      reject(new Error("Google Mapsスクリプトの読み込みに失敗しました"));
    document.head.appendChild(script);
  }).catch((error) => {
    // 失敗した script タグと callback を取り除き、次回呼び出しで再試行可能にする。
    googleMapsScriptPromise = null;
    document.getElementById(SCRIPT_ID)?.remove();
    delete window[CALLBACK_NAME];
    throw error;
  });

  return googleMapsScriptPromise;
}

/**
 * エリア検索結果を表示する地図。
 *
 * - `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` が未設定の場合は地図を描画せず、
 *   設定方法を案内するメッセージのみ表示する (一覧検索自体は引き続き利用可能)。
 * - 中心地点ピン・半径円・店舗ピン (状態ごとに色分け) を描画する。
 * - 店舗ピンをクリックすると `onActivatePlace` で一覧側に通知し、
 *   `activePlaceId` に対応するピンは強調表示される。
 */
export function AreaSearchMap({
  center,
  radiusMeters,
  places,
  addedIds,
  activePlaceId,
  onActivatePlace,
  onPinClick,
}: AreaSearchMapProps) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const centerMarkerRef = useRef<google.maps.Marker | null>(null);
  const circleRef = useRef<google.maps.Circle | null>(null);
  const markersRef = useRef<
    Map<string, { marker: google.maps.Marker; listener: google.maps.MapsEventListener }>
  >(new Map());
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // L1: tracks the last search params for which we auto-zoomed; avoids overriding
  // a user's manual zoom when the same search result is re-rendered.
  const prevSearchRef = useRef<{ center: SearchCenter; radiusMeters: number } | null>(null);

  // スクリプト読込 + 地図初期化
  useEffect(() => {
    if (!apiKey) return;
    let cancelled = false;
    loadGoogleMapsScript(apiKey)
      .then(() => {
        if (cancelled || !containerRef.current || !window.google) return;
        try {
          mapRef.current = new window.google.maps.Map(containerRef.current, {
            center,
            zoom: zoomForRadius(radiusMeters),
            disableDefaultUI: true,
            zoomControl: true,
          });
          setStatus("ready");
        } catch (error) {
          console.error("[AreaSearchMap] Google Maps init failed", error);
          if (!cancelled) {
            setStatus("error");
            setErrorMessage(
              error instanceof Error ? error.message : "Google Mapsの初期化に失敗しました",
            );
          }
        }
      })
      .catch((error) => {
        console.error("[AreaSearchMap] Google Maps load failed", error);
        if (!cancelled) {
          setStatus("error");
          setErrorMessage(
            error instanceof Error ? error.message : "Google Mapsの読み込みに失敗しました",
          );
        }
      });
    return () => {
      cancelled = true;
    };
    // 初回マウント時のみスクリプトを読み込む (中心・半径変更は別の effect で反映)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey]);

  // 中心地点ピン・半径円の描画/更新
  useEffect(() => {
    const map = mapRef.current;
    const google = window.google;
    if (!map || !google || status !== "ready") return;

    map.setCenter(center);

    // Auto-zoom only on initial display or when search parameters actually change.
    // If center and radius are unchanged the user may have zoomed manually — keep their level.
    const prev = prevSearchRef.current;
    const isNewSearch =
      prev === null ||
      prev.radiusMeters !== radiusMeters ||
      prev.center.lat !== center.lat ||
      prev.center.lng !== center.lng;
    if (isNewSearch) {
      map.setZoom(zoomForRadius(radiusMeters));
      prevSearchRef.current = { center, radiusMeters };
    }

    if (!centerMarkerRef.current) {
      centerMarkerRef.current = new google.maps.Marker({
        position: center,
        map,
        title: "中心地点",
        zIndex: 1000,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: "#dc2626",
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 2,
        },
      });
    } else {
      centerMarkerRef.current.setPosition(center);
    }

    if (!circleRef.current) {
      circleRef.current = new google.maps.Circle({
        center,
        radius: radiusMeters,
        map,
        strokeColor: "#2563eb",
        strokeOpacity: 0.5,
        strokeWeight: 1,
        fillColor: "#2563eb",
        fillOpacity: 0.08,
      });
    } else {
      circleRef.current.setCenter(center);
      circleRef.current.setRadius(radiusMeters);
    }
  }, [center, radiusMeters, status]);

  // 店舗ピンの同期 (追加/更新/削除)
  useEffect(() => {
    const map = mapRef.current;
    const google = window.google;
    if (!map || !google || status !== "ready") return;

    const markers = markersRef.current;
    const seen = new Set<string>();

    for (const vm of places) {
      const placeId = vm.place.placeId;
      seen.add(placeId);
      const isActive = placeId === activePlaceId;
      const color = markerColorFor(vm, addedIds.has(placeId));
      const icon: google.maps.Symbol = {
        path: google.maps.SymbolPath.CIRCLE,
        scale: isActive ? 10 : 7,
        fillColor: color,
        fillOpacity: 0.9,
        strokeColor: "#ffffff",
        strokeWeight: isActive ? 2 : 1,
      };

      let entry = markers.get(placeId);
      if (!entry) {
        const marker = new google.maps.Marker({
          position: { lat: vm.place.lat, lng: vm.place.lng },
          map,
          title: vm.place.name,
        });
        const listener = marker.addListener("click", () => {
          onActivatePlace(placeId);
          onPinClick?.(placeId);
        });
        entry = { marker, listener };
        markers.set(placeId, entry);
      }
      entry.marker.setIcon(icon);
      entry.marker.setZIndex(isActive ? 999 : 1);
    }

    for (const [placeId, entry] of markers) {
      if (!seen.has(placeId)) {
        entry.listener.remove();
        entry.marker.setMap(null);
        markers.delete(placeId);
      }
    }
  }, [places, addedIds, activePlaceId, status, onActivatePlace, onPinClick]);

  // unmount時のクリーンアップ: map instance / marker / circle / listener を破棄する。
  // Google Maps script 自体はページ全体で共有するため削除しない。
  useEffect(() => {
    const markers = markersRef.current;
    return () => {
      for (const { marker, listener } of markers.values()) {
        listener.remove();
        marker.setMap(null);
      }
      markers.clear();

      centerMarkerRef.current?.setMap(null);
      circleRef.current?.setMap(null);

      centerMarkerRef.current = null;
      circleRef.current = null;
      mapRef.current = null;
    };
  }, []);

  if (!apiKey) {
    // NEXT_PUBLIC_GOOGLE_MAPS_API_KEY が未設定の場合は地図エリア自体を出さない。
    // Places API キー (=エリア検索の前提) は別変数 (GOOGLE_PLACES_API_KEY) で、
    // そちらの未設定警告は AreaSearchPanel 側で EmptyState として 1 箇所に集約している。
    return null;
  }

  return (
    <div className="space-y-2">
      {status === "error" ? (
        // H2: show error inside the map area instead of an empty gray box + text below
        <div
          role="alert"
          className="flex h-[280px] lg:h-[520px] w-full flex-col items-center justify-center gap-1 rounded-md border border-border bg-muted"
        >
          <p className="text-sm text-destructive">地図の読み込みに失敗しました。</p>
          {process.env.NODE_ENV === "development" && errorMessage && (
            <p className="text-[11px] text-muted-foreground">{errorMessage}</p>
          )}
        </div>
      ) : (
        <>
          <div
            ref={containerRef}
            className="h-[280px] lg:h-[520px] w-full rounded-md border border-border bg-muted"
          />
          {status === "loading" && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Spinner className="h-3 w-3" />
              地図を読み込み中…
            </p>
          )}
        </>
      )}
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <li className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#2563eb]" />
          登録候補
        </li>
        <li className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#9ca3af]" />
          DB登録済み
        </li>
        <li className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#16a34a]" />
          追加済み
        </li>
        <li className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#d1d5db]" />
          範囲外
        </li>
        <li className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#dc2626]" />
          中心地点
        </li>
      </ul>
    </div>
  );
}
