"use client";

import Link from "next/link";
import { ExternalLink, MapPin, Phone } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { StarRating } from "@/components/ui/star-rating";
import { AddStoreButton } from "./add-store-button";
import { mapGenre } from "@/lib/places/to-store-input";
import type { PlaceWithMatch } from "@/lib/places/types";

interface PlaceResultListProps {
  results: readonly PlaceWithMatch[];
  addedIds: ReadonlySet<string>;
  selectedIds: ReadonlySet<string>;
  onAdded: (placeId: string) => void;
  onToggle: (placeId: string) => void;
}

export function PlaceResultList({
  results,
  addedIds,
  selectedIds,
  onAdded,
  onToggle,
}: PlaceResultListProps) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {results.length} 件の店舗が見つかりました
      </p>
      <ul className="space-y-2">
        {results.map(({ place, matchedStore }) => {
          const isAdded = addedIds.has(place.placeId);
          const isEligible = matchedStore === null && !isAdded;
          const isSelected = selectedIds.has(place.placeId);
          const genre = mapGenre(place.types);

          return (
            <li key={place.placeId}>
              <Card>
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
                    </div>

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
