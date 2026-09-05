"use client";

import Link from "next/link";
import { ExternalLink, MapPin, Phone } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { StarRating } from "@/components/ui/star-rating";
import { AddStoreButton } from "./add-store-button";
import { mapGenre } from "@/lib/places/to-store-input";
import { getAreaSearchRankingReasons } from "@/lib/places/ranking";
import { formatCandidateInfoLine } from "@/lib/places/candidate-info";
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
  /** Place Detailsオンデマンド取得が実行中の placeId 一覧。 */
  detailsLoadingPlaceIds: ReadonlySet<string>;
  /** Place Detailsオンデマンド取得が完了済みの placeId 一覧。 */
  detailsLoadedPlaceIds: ReadonlySet<string>;
  /** Place Detailsオンデマンド取得が失敗した placeId ごとのエラーメッセージ。 */
  detailsErrors: Record<string, string>;
  /** 「詳細取得」ボタン押下時の通知 (placeId を渡す)。 */
  onFetchDetails: (placeId: string) => void;
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
  detailsLoadingPlaceIds,
  detailsLoadedPlaceIds,
  detailsErrors,
  onFetchDetails,
}: PlaceResultListProps) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {results.length} 件の店舗が見つかりました
      </p>
      <ul className="space-y-2">
        {results.map((result) => {
          const { place, matchedStore, distanceMeters, isWithinRadius } = result;
          const isAdded = addedIds.has(place.placeId);
          const isEligible = matchedStore === null && !isAdded;
          const isSelected = selectedIds.has(place.placeId);
          const isActive = activePlaceId === place.placeId;
          const isPinClicked = pinClickedPlaceId === place.placeId;
          const genre = mapGenre(place.types);
          const rankingReasons = getAreaSearchRankingReasons(result, addedIds);
          const candidateInfoLine = formatCandidateInfoLine(result.candidateInfo);
          const isDetailsLoading = detailsLoadingPlaceIds.has(place.placeId);
          const isDetailsLoaded = detailsLoadedPlaceIds.has(place.placeId);
          const detailsError = detailsErrors[place.placeId];

          return (
            <li
              key={place.placeId}
              data-place-id={place.placeId}
              // li 自体を tabIndex で focusable にする。onFocus/onBlur は focusin/focusout で
              // バブルするため、子コントロール (チェックボックス・追加ボタン・各リンク) への
              // フォーカスでもピン連動は成立する。それでも tabIndex を残すのは、追加済み
              // (AddStoreButton が非フォーカスな Badge を返す) かつ Google Maps リンクも無い行では
              // フォーカス可能な子が一切無くなり、キーボード単独ユーザーのピン連動到達手段が
              // 失われるため。この行は意図的に冗長なタブストップを許容している。
              // なお li は checkbox/button/link を内包するため role="button" は ARIA 違反になり付与しない。
              tabIndex={0}
              className="focus-visible:outline-none"
              onMouseEnter={() => onActivatePlace(place.placeId)}
              onMouseLeave={() => onActivatePlace(null)}
              onClick={() => onActivatePlace(place.placeId)}
              onFocus={() => onActivatePlace(place.placeId)}
              onBlur={(e) => {
                // フォーカスが li 内の子要素に移動した場合はピン連動を解除しない
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                  onActivatePlace(null);
                }
              }}
              onKeyDown={(e) => {
                // li 自体がフォーカスを持つとき Enter / Space で地図ピンを連動させる
                if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  onActivatePlace(place.placeId);
                }
              }}
            >
              <Card
                className={cn(
                  "transition-[box-shadow,opacity,ring]",
                  isActive && "ring-2 ring-primary",
                  isPinClicked && "ring-2 ring-info shadow-lg",
                  !isWithinRadius && "opacity-60",
                )}
              >
                <Card.Body className="flex items-start gap-3">
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

                    <p className="text-[11px] text-muted-foreground">
                      {rankingReasons.join(" / ")}
                    </p>

                    {candidateInfoLine && (
                      <p className="text-[11px] text-muted-foreground">
                        {candidateInfoLine}
                      </p>
                    )}

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

                    {isDetailsLoaded && (
                      <p className="text-xs text-muted-foreground">
                        Webサイト: {result.websiteUri ? "あり" : "なし"}
                        {result.businessStatus && ` / 営業状態: ${result.businessStatus}`}
                      </p>
                    )}

                    {detailsError && (
                      <p role="alert" className="text-xs text-destructive">
                        {detailsError}
                      </p>
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

                    {place.placeId && (
                      <div className="flex flex-col items-end gap-0.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          gap="tight"
                          onClick={(e) => {
                            e.stopPropagation();
                            onFetchDetails(place.placeId);
                          }}
                          disabled={isDetailsLoading || isDetailsLoaded}
                        >
                          {isDetailsLoading ? (
                            <>
                              <Spinner size="sm" />
                              取得中…
                            </>
                          ) : isDetailsLoaded ? (
                            "詳細取得済み"
                          ) : (
                            "詳細取得"
                          )}
                        </Button>
                        {!isDetailsLoaded && (
                          <p className="text-[10px] text-muted-foreground">
                            電話番号・Webサイト・評価を取得（API目安 +1回）
                          </p>
                        )}
                      </div>
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
