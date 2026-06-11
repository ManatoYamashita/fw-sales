"use client";

import { useEffect, useRef, useState } from "react";
import { Spinner } from "@/components/ui/spinner";
import type { AreaSearchPlaceViewModel, SearchCenter } from "@/lib/places/types";

export interface AreaSearchMapProps {
  center: SearchCenter;
  radiusMeters: number;
  places: readonly AreaSearchPlaceViewModel[];
  addedIds: ReadonlySet<string>;
  activePlaceId: string | null;
  onActivatePlace: (placeId: string | null) => void;
}

const SCRIPT_ID = "area-search-google-maps-script";

const PIN_COLORS = {
  eligible: "#2563eb", // 登録候補: 青
  registered: "#9ca3af", // DB登録済み: グレー
  added: "#16a34a", // 追加済み: 緑
  outOfRange: "#d1d5db", // 範囲外: 薄いグレー
} as const;

function loadGoogleMapsScript(apiKey: string): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("window is not available"));
  }
  if (window.google?.maps) {
    return Promise.resolve();
  }

  const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
  if (existing) {
    if (window.google?.maps) return Promise.resolve();
    return new Promise((resolve, reject) => {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("Google Mapsの読み込みに失敗しました")),
        { once: true },
      );
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&loading=async`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Google Mapsの読み込みに失敗しました"));
    document.head.appendChild(script);
  });
}

/** 半径(m)からおおよそ全体が収まるズームレベルを返す簡易マッピング。 */
function zoomForRadius(radiusMeters: number): number {
  if (radiusMeters <= 500) return 16;
  if (radiusMeters <= 1000) return 15;
  if (radiusMeters <= 2000) return 14;
  return 13;
}

function markerColorFor(
  place: AreaSearchPlaceViewModel,
  isAdded: boolean,
): string {
  if (isAdded) return PIN_COLORS.added;
  if (place.matchedStore !== null) return PIN_COLORS.registered;
  if (!place.isWithinRadius) return PIN_COLORS.outOfRange;
  return PIN_COLORS.eligible;
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
}: AreaSearchMapProps) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const centerMarkerRef = useRef<google.maps.Marker | null>(null);
  const circleRef = useRef<google.maps.Circle | null>(null);
  const markersRef = useRef<Map<string, google.maps.Marker>>(new Map());
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  // スクリプト読込 + 地図初期化
  useEffect(() => {
    if (!apiKey) return;
    let cancelled = false;
    loadGoogleMapsScript(apiKey)
      .then(() => {
        if (cancelled || !containerRef.current || !window.google) return;
        mapRef.current = new window.google.maps.Map(containerRef.current, {
          center,
          zoom: zoomForRadius(radiusMeters),
          disableDefaultUI: true,
          zoomControl: true,
        });
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
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
    map.setZoom(zoomForRadius(radiusMeters));

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

      let marker = markers.get(placeId);
      if (!marker) {
        marker = new google.maps.Marker({
          position: { lat: vm.place.lat, lng: vm.place.lng },
          map,
          title: vm.place.name,
        });
        marker.addListener("click", () => onActivatePlace(placeId));
        markers.set(placeId, marker);
      }
      marker.setIcon(icon);
      marker.setZIndex(isActive ? 999 : 1);
    }

    for (const [placeId, marker] of markers) {
      if (!seen.has(placeId)) {
        marker.setMap(null);
        markers.delete(placeId);
      }
    }
  }, [places, addedIds, activePlaceId, status, onActivatePlace]);

  if (!apiKey) {
    return (
      <div className="rounded-md border border-border bg-muted/30 px-4 py-3 text-sm space-y-1">
        <p className="font-medium text-foreground">地図は表示されていません</p>
        <p className="text-muted-foreground">
          地図を表示するには Google Maps JavaScript API
          キーの設定が必要です(環境変数{" "}
          <code className="font-mono text-xs bg-background rounded border border-border px-1 py-0.5">
            NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
          </code>
          )。一覧検索はこのまま利用できます。
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
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
      {status === "error" && (
        <p role="alert" className="text-xs text-destructive">
          地図の読み込みに失敗しました。
        </p>
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
