"use client";

import Link from "next/link";
import { MapPin, Phone } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { StarRating } from "@/components/ui/star-rating";
import { AddStoreButton } from "./add-store-button";
import type { PlaceWithMatch } from "@/lib/places/types";

interface PlaceResultListProps {
  results: PlaceWithMatch[];
  addedIds: ReadonlySet<string>;
  onAdded: (placeId: string) => void;
}

export function PlaceResultList({ results, addedIds, onAdded }: PlaceResultListProps) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {results.length} 件の店舗が見つかりました
      </p>
      <ul className="space-y-2">
        {results.map(({ place, matchedStore }) => (
          <li key={place.placeId}>
            <Card>
              <Card.Body className="flex items-start justify-between gap-4 py-4">
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="font-semibold text-foreground leading-snug">
                    {place.name}
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
                </div>

                <div className="shrink-0 flex flex-col items-end gap-1.5">
                  {matchedStore !== null ? (
                    // DB登録済み: バッジ + 編集リンク
                    <>
                      <Badge tone="success">DB登録済み</Badge>
                      <Link
                        href={`/stores/${matchedStore.id}`}
                        className={buttonVariants({ variant: "outline", size: "sm" })}
                      >
                        編集
                      </Link>
                    </>
                  ) : (
                    // 未登録: 追加ボタン (追加済みバッジも内包)
                    <AddStoreButton
                      placeId={place.placeId}
                      placeName={place.name}
                      isAdded={addedIds.has(place.placeId)}
                      onAdded={onAdded}
                    />
                  )}
                </div>
              </Card.Body>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
