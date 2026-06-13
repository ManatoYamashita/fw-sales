"use client";

import Link from "next/link";
import { ExternalLink, MapPin, Phone } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { StarRating } from "@/components/ui/star-rating";
import { AddStoreButton } from "./add-store-button";
import { mapGenre } from "@/lib/places/to-store-input";
import { formatDistanceMeters } from "@/lib/utils/geo";
import { cn } from "@/lib/utils/cn";
import type { AreaSearchPlaceViewModel } from "@/lib/places/types";

interface PlaceResultListProps {
  results: readonly AreaSearchPlaceViewModel[];
  addedIds: ReadonlySet<string>;
  selectedIds: ReadonlySet<string>;
  /** 距離表示の起点ラベル (例: "渋谷駅")。中心地点の入力値をそのまま使う。 */
  centerLabel: string;
  /** 地図と連動して強調表示する placeId (ホバー連動)。 */
  activePlaceId: string | null;
  /** マップピン明示クリック直後にハイライトする placeId。2秒後に null に戻る。 */
  pinClickedPlaceId?: string | null;
  /** カードのホバー/クリックで地図側のピンを強調するための通知。 */
  onActivatePlace: (placeId: string | null) => void;
  onAdded: (placeId: string) => void;
  onToggle: (placeId: string) => void;
}

export function PlaceResultList({
  results,
  addedIds,
  selectedIds,
  centerLabel,
  activePlaceId,
  pinClickedPlaceId,
  onActivatePlace,
  onAdded,
  onToggle,
}: PlaceResultListProps) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {results.length} 件の店舗が見つかりました
      </p>
      <ul className="space-y-2">
        {results.map(({ place, matchedStore, distanceMeters, isWithinRadius }) => {
          const isAdded = addedIds.has(place.placeId);
          const isEligible = matchedStore === null && !isAdded;
          const isSelected = selectedIds.has(place.placeId);
          const isActive = activePlaceId === place.placeId;
          const isPinClicked = pinClickedPlaceId === place.placeId;
          const genre = mapGenre(place.types);

          return (
            <li
              key={place.placeId}
              data-place-id={place.placeId}
              onMouseEnter={() => onActivatePlace(place.placeId)}
              onMouseLeave={() => onActivatePlace(null)}
              onClick={() => onActivatePlace(place.placeId)}
            >
              <Card
                className={cn(
                  "transition-[box-shadow,opacity,ring]",
                  isActive && "ring-2 ring-primary",
                  isPinClicked && "ring-2 ring-info shadow-lg",
                  !isWithinRadius && "opacity-60",
                )}
              >
                <Card.Body className="flex items-start gap-3 py-4">
                  {/* チェックボックス列: 選択可能な店舗のみ表示、幅を固定して揃える */}
                  <div className="pt-0.5 shrink-0 w-4">
                    {isEligible && (
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => onToggle(place.placeId)}
                        aria-label={`${place.name}を選択`}
                        className="h-4 w-4 cursor-pointer accent-primary"
                      />
                    )}
                  </div>

                  {/* 店舗情報 */}
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <p className="font-semibold text-foreground leading-snug">
                        {place.name}
                      </p>
                      {genre && <Badge tone="secondary">{genre}</Badge>}
                      {!isWithinRadius && <Badge tone="outline">範囲外</Badge>}
                    </div>

                    <p className="text-xs text-muted-foreground">
                      {centerLabel}から {formatDistanceMeters(distanceMeters)}
                    </p>

                    {place.formattedAddress && (
                      <p className="flex items-start gap-1 text-sm text-muted-foreground">
                        <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                        <span className="break-all">{place.formattedAddress}</span>
                      </p>
                    )}

                    {place.phone && (
                      <p className="flex items-center gap-1 text-sm text-muted-foreground">
                        <Phone className="h-3.5 w-3.5 shrink-0" />
                        {place.phone}
                      </p>
                    )}

                    {place.rating !== null && (
                      <span className="inline-flex items-center gap-1.5">
                        <StarRating value={place.rating} showValue />
                        {place.userRatingsTotal !== null && (
                          <span className="text-xs text-muted-foreground">
                            {place.userRatingsTotal.toLocaleString()} 件
                          </span>
                        )}
                      </span>
                    )}

                    {place.googleMapsUri && (
                      <a
                        href={place.googleMapsUri}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-sm text-info hover:underline w-fit"
                      >
                        <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                        Google Mapsで見る
                      </a>
                    )}
                  </div>

                  {/* アクション列 */}
                  <div className="shrink-0 flex flex-col items-end gap-1.5">
                    {matchedStore !== null ? (
                      <>
                        <Badge tone="success">DB登録済み</Badge>
                        <Link
                          href={`/stores/${matchedStore.id}`}
                          className={buttonVariants({ variant: "outline", size: "sm" })}
                        >
                          既存店舗を確認
                        </Link>
                      </>
                    ) : (
                      <AddStoreButton
                        placeId={place.placeId}
                        placeName={place.name}
                        isAdded={isAdded}
                        onAdded={onAdded}
                      />
                    )}
                  </div>
                </Card.Body>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
