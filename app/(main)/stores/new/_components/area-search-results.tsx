"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { PlaceResultList } from "./place-result-list";
import { AreaSearchMap } from "./area-search-map";
import {
  bulkAddStoresFromPlacesAction,
  searchPlacesWithMatchesAction,
} from "@/lib/actions/area-search-actions";
import { mergeUniquePlaces, mergeUniquePlacesWithStats } from "@/lib/places/bulk-utils";
import {
  FEW_ELIGIBLE_THRESHOLD,
  SEARCH_RESULT_SOFT_LIMIT,
  buildExplorationRunId,
  recomputeViewModel,
  suggestExplorationCenters,
  suggestExplorationKeywords,
  suggestLargerRadii,
  type ExplorationKind,
} from "@/lib/places/exploration";
import { formatDistanceMeters } from "@/lib/utils/geo";
import type { AreaSearchPlaceViewModel, SearchCenter } from "@/lib/places/types";

/**
 * 一覧の絞り込み区分。
 * - `all`: 読み込み済み全件 (デフォルト)
 * - `eligible`: 一括追加対象になる「登録候補」(DB未登録 かつ 未追加)のみ
 * - `registered`: DB登録済みの店舗のみ
 * - `inRange`: 中心地点から半径内の店舗のみ
 */
type ResultFilter = "all" | "eligible" | "registered" | "inRange";

const RESULT_FILTER_LABELS: Record<ResultFilter, string> = {
  all: "すべて",
  eligible: "登録候補のみ",
  registered: "DB登録済み",
  inRange: "範囲内のみ",
};

/** 一括追加対象 (登録候補): DB未登録 かつ まだ追加していない店舗 */
function isEligiblePlace(
  { place, matchedStore }: AreaSearchPlaceViewModel,
  addedIds: ReadonlySet<string>,
): boolean {
  return matchedStore === null && !addedIds.has(place.placeId);
}

/** 「追加探索」1回分の実行記録 (画面内 state のみ。DB保存しない)。 */
interface ExplorationRun {
  id: string;
  kind: ExplorationKind;
  keyword: string;
  centerQuery: string;
  radiusMeters: number;
  fetchedCount: number;
  addedUniqueCount: number;
  duplicateCount: number;
  eligibleCount: number;
  registeredCount: number;
}

/** 探索履歴に保持する最大件数。 */
const EXPLORATION_HISTORY_LIMIT = 5;

const EXPLORATION_KIND_LABELS: Record<ExplorationKind, string> = {
  keyword: "別キーワード",
  center: "周辺地点",
  radius: "半径拡大",
};

export interface AreaSearchResultsProps {
  results: readonly AreaSearchPlaceViewModel[];
  /** 初回検索の `nextPageToken`。次ページが無い場合は null。 */
  nextPageToken: string | null;
  /** 「さらに候補を読み込む」で同じ条件を再送するための初回検索キーワード。 */
  keyword: string;
  /** 中心地点入力値 (駅名・住所など)。距離表示の起点ラベルとしても使う。 */
  area: string;
  /** `area` を解決した緯度経度。「さらに候補を読み込む」でも再利用する。 */
  center: SearchCenter;
  /** 検索半径 (メートル)。 */
  radiusMeters: number;
}

/**
 * エリア検索結果の一覧 + 地図 + 一括登録コントロール。
 * 親の `AreaSearchPanel` から検索結果を受け取り、選択/登録/追加ページ読込/地図連動の
 * 状態は内部で完結する。再検索のたびに親側で `key` を変えて再マウントする想定 (state は
 * 初回 props のみを初期値として持ち、以後は内部で更新する)。
 */
export function AreaSearchResults({
  results,
  nextPageToken: initialNextPageToken,
  keyword,
  area,
  center,
  radiusMeters,
}: AreaSearchResultsProps) {
  const [allResults, setAllResults] =
    useState<readonly AreaSearchPlaceViewModel[]>(results);
  const [nextPageToken, setNextPageToken] = useState<string | null>(
    initialNextPageToken,
  );
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [isLoadingMore, startLoadMoreTransition] = useTransition();
  const [addedIds, setAddedIds] = useState<ReadonlySet<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [resultFilter, setResultFilter] = useState<ResultFilter>("all");
  // 一覧カードのホバー/クリック、地図ピンのクリックで連動して強調する placeId。
  const [activePlaceId, setActivePlaceId] = useState<string | null>(null);
  // bulkResult は全件失敗 (added === 0) のときだけ set される失敗専用の結果。
  const [bulkResult, setBulkResult] = useState<{ failed: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBulkPending, startBulkTransition] = useTransition();
  // メイン半径。「半径を広げる」追加探索でのみ更新する (中心地点・キーワードは固定)。
  const [mainRadiusMeters, setMainRadiusMeters] = useState(radiusMeters);
  const [explorationRuns, setExplorationRuns] = useState<readonly ExplorationRun[]>(
    [],
  );
  const [exploredRunIds, setExploredRunIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [explorationPendingId, setExplorationPendingId] = useState<string | null>(
    null,
  );
  const [explorationError, setExplorationError] = useState<string | null>(null);
  const [, startExplorationTransition] = useTransition();
  const router = useRouter();

  const showBar = selectedIds.size >= 1;

  // 件数サマリー (営業担当が「取りこぼしていないか」を把握するための指標)。
  const loadedCount = allResults.length;
  const registeredCount = allResults.filter(
    ({ matchedStore }) => matchedStore !== null,
  ).length;
  const addedCount = allResults.filter(({ place }) =>
    addedIds.has(place.placeId),
  ).length;
  const eligibleCount = allResults.filter((vm) =>
    isEligiblePlace(vm, addedIds),
  ).length;
  const inRangeCount = allResults.filter((vm) => vm.isWithinRadius).length;
  const outOfRangeCount = loadedCount - inRangeCount;

  // 一覧・地図の絞り込み。matchedStore は検索時点のDB照合結果のスナップショットのため、
  // 画面内で追加済み (addedIds) になった店舗も matchedStore === null のままだが、
  // 「DB照合時点では未登録だった」という意味で「登録候補のみ」からは除外する
  // (addedIds.has で判定)。登録済み店舗はもともと選択不可のため、
  // 選択状態 (selectedIds/addedIds) には影響しない。
  const displayedResults =
    resultFilter === "eligible"
      ? allResults.filter((vm) => isEligiblePlace(vm, addedIds))
      : resultFilter === "registered"
        ? allResults.filter(({ matchedStore }) => matchedStore !== null)
        : resultFilter === "inRange"
          ? allResults.filter((vm) => vm.isWithinRadius)
          : allResults;

  // 「全選択」の対象は常に「現在のフィルタで表示中の登録候補」。
  // 「範囲内のみ」フィルタ中は範囲内に表示中の登録候補のみが対象になる。
  const displayedEligibleCount = displayedResults.filter((vm) =>
    isEligiblePlace(vm, addedIds),
  ).length;

  const radiusLabel = formatDistanceMeters(mainRadiusMeters);

  const handleLoadMore = () => {
    if (!nextPageToken) return;
    setLoadMoreError(null);
    startLoadMoreTransition(async () => {
      const result = await searchPlacesWithMatchesAction(
        keyword,
        area,
        mainRadiusMeters,
        { pageToken: nextPageToken, center },
      );
      if (!result.ok) {
        setLoadMoreError(result.error);
        return;
      }
      setAllResults((prev) => mergeUniquePlaces(prev, result.data.places));
      setNextPageToken(result.data.nextPageToken);
    });
  };

  /**
   * 「追加探索」: チップ押下時のみ実行する (自動実行・大量実行はしない)。
   * - keyword: 別キーワード × メイン中心地点・メイン半径
   * - center: メインキーワード × 周辺地点 × メイン半径
   * - radius: メインキーワード × メイン中心地点 × より大きい半径
   *   (案A: メイン半径自体を更新し、既存結果も新半径基準で再判定する)
   *
   * 取得結果は、表示上の範囲内/範囲外判定が「メイン中心地点・メイン半径」基準で
   * 一貫するよう `recomputeViewModel` で再計算してから統合する。
   */
  const handleExplore = (kind: ExplorationKind, value: string | number) => {
    const explKeyword = kind === "keyword" ? String(value) : keyword;
    const explCenterQuery = kind === "center" ? String(value) : area;
    const explRadius = kind === "radius" ? Number(value) : mainRadiusMeters;
    const runId = buildExplorationRunId(kind, explKeyword, explCenterQuery, explRadius);
    if (explorationPendingId || exploredRunIds.has(runId)) return;

    setExplorationError(null);
    setExplorationPendingId(runId);
    // center 探索のみ中心地点を未指定にし、新たに resolveSearchCenter させる。
    // keyword/radius 探索はメイン中心地点をそのまま使い回す。
    const options = kind === "center" ? undefined : { center };

    startExplorationTransition(async () => {
      const result = await searchPlacesWithMatchesAction(
        explKeyword,
        explCenterQuery,
        explRadius,
        options,
      );
      setExplorationPendingId(null);
      setExploredRunIds((prev) => new Set([...prev, runId]));

      if (!result.ok) {
        setExplorationError(result.error);
        return;
      }

      const fetchedCount = result.data.places.length;
      const recomputed = result.data.places.map((vm) =>
        recomputeViewModel(vm, center, explRadius),
      );

      setAllResults((prev) => {
        // 半径拡大時は、既存結果も新半径基準で範囲内/範囲外を判定し直す。
        const base =
          kind === "radius"
            ? prev.map((vm) => recomputeViewModel(vm, center, explRadius))
            : prev;
        const { merged, addedCount, duplicateCount } = mergeUniquePlacesWithStats(
          base,
          recomputed,
        );
        const newlyAdded = merged.slice(merged.length - addedCount);
        setExplorationRuns((runs) =>
          [
            {
              id: runId,
              kind,
              keyword: explKeyword,
              centerQuery: explCenterQuery,
              radiusMeters: explRadius,
              fetchedCount,
              addedUniqueCount: addedCount,
              duplicateCount,
              eligibleCount: newlyAdded.filter((vm) => isEligiblePlace(vm, addedIds))
                .length,
              registeredCount: newlyAdded.filter((vm) => vm.matchedStore !== null)
                .length,
            },
            ...runs,
          ].slice(0, EXPLORATION_HISTORY_LIMIT),
        );
        return merged;
      });

      if (kind === "radius") {
        setMainRadiusMeters(explRadius);
        setNextPageToken(result.data.nextPageToken);
      }
    });
  };

  const handleAdded = (placeId: string) => {
    setAddedIds((prev) => new Set([...prev, placeId]));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(placeId);
      return next;
    });
  };

  const handleToggle = (placeId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(placeId)) {
        next.delete(placeId);
      } else {
        next.add(placeId);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    const eligible = displayedResults
      .filter((vm) => isEligiblePlace(vm, addedIds))
      .map(({ place }) => place.placeId);
    setSelectedIds(new Set(eligible));
  };

  const handleDeselectAll = () => {
    setSelectedIds(new Set());
  };

  const handleBulkAdd = () => {
    setBulkResult(null);
    setError(null);
    const ids = [...selectedIds];
    startBulkTransition(async () => {
      const result = await bulkAddStoresFromPlacesAction(ids);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const { added, failed, failedPlaceIds } = result.data;
      if (added > 0) {
        // 1 件でも追加できたら登録店舗一覧へ遷移する (失敗分は toast で通知)。
        toast.success(
          failed > 0
            ? `${added}件を登録しました（${failed}件は失敗）`
            : `${added}件を登録しました`,
        );
        router.push("/stores");
        return;
      }
      // added === 0 (全件失敗): 留まって結果を表示し、再試行できるようにする。
      const failedSet = new Set(failedPlaceIds);
      const succeededIds = ids.filter((id) => !failedSet.has(id));
      setAddedIds((prev) => new Set([...prev, ...succeededIds]));
      setSelectedIds(new Set());
      setBulkResult({ failed });
    });
  };

  // 「全選択」導線のヘルパー文言。「範囲内のみ」フィルタ中はその旨を明示する。
  const selectAllHelperText =
    resultFilter === "inRange"
      ? "範囲内に表示中の登録候補が対象です。まだ読み込んでいない候補は対象外です。"
      : "表示中の登録候補が対象です。まだ読み込んでいない候補は対象外です。";

  // 探索カバレッジ強化: 「この条件の上限まで読み込み済み」「登録候補が少ない」の判定と、
  // 追加探索チップの候補。
  const isSearchLimitReached =
    nextPageToken === null && loadedCount >= SEARCH_RESULT_SOFT_LIMIT;
  const hasFewEligibleResults = eligibleCount <= FEW_ELIGIBLE_THRESHOLD;
  const totalDuplicateCount = explorationRuns.reduce(
    (sum, run) => sum + run.duplicateCount,
    0,
  );

  const keywordChips = suggestExplorationKeywords(keyword);
  const centerChips = suggestExplorationCenters(area);
  const radiusChips = suggestLargerRadii(mainRadiusMeters);

  return (
    <div className="space-y-4">
      {/* 検索条件・取得状況・件数サマリー: 「どこまで取得済みか」「取りこぼしていないか」の不安を減らす */}
      <div className="rounded-md border border-border bg-muted/30 px-4 py-3 text-sm space-y-1">
        <p className="text-foreground">
          検索条件: <span className="font-medium">{keyword}</span> /{" "}
          <span className="font-medium">{area}</span> / 半径
          <span className="font-medium">{radiusLabel}</span>
        </p>
        <p className="text-muted-foreground">
          読み込み済み {loadedCount}件 (範囲内 {inRangeCount}件 / 範囲外{" "}
          {outOfRangeCount}件)
        </p>
        <p className="text-muted-foreground">
          登録候補 {eligibleCount}件 / DB登録済み {registeredCount}件 / 追加済み{" "}
          {addedCount}件
        </p>
        {explorationRuns.length > 0 && (
          <p className="text-muted-foreground">
            統合結果: 読み込み済み {loadedCount}件 / 登録候補 {eligibleCount}件 /
            DB登録済み {registeredCount}件 / 重複除外 {totalDuplicateCount}件
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Google
          Placesの検索結果に対して、中心地点からの距離を計算し範囲内/範囲外を判定しています。範囲外の候補は一覧・地図に薄く表示されます。
        </p>
      </div>

      {/* 検索条件の上限到達・登録候補が少ない場合の案内。
          「渋谷の居酒屋を全件取得した」と誤解させないため、上限到達時は必ず
          「全店舗を保証するものではない」旨を明示する。 */}
      {(isSearchLimitReached || hasFewEligibleResults) && (
        <div className="rounded-md border border-border bg-muted/30 px-4 py-3 text-sm space-y-1">
          {isSearchLimitReached && (
            <p className="text-foreground">
              この条件では最大件数まで読み込み済みです。Google
              Placesの検索結果であり、この範囲内の全店舗を保証するものではありません。未登録候補をさらに探すには条件を変えて探索してください。
            </p>
          )}
          {hasFewEligibleResults && (
            <p className="text-muted-foreground">
              読み込み済み結果では登録候補が少なめです。未登録店舗をさらに探すには、下記の「追加探索」でキーワード・中心地点・半径を変えて探索してください。
            </p>
          )}
        </div>
      )}

      {/* 追加探索: 「さらに候補を読み込む」(同一条件の次ページ取得) とは異なり、
          条件 (キーワード/中心地点/半径) を変えて別の候補集合を探す。
          チップ押下時のみ API を呼び出し、自動では実行しない。 */}
      {(keywordChips.length > 0 || centerChips.length > 0 || radiusChips.length > 0) && (
        <div className="rounded-md border border-border px-4 py-3 text-sm space-y-3">
          <div className="space-y-1">
            <p className="font-medium text-foreground">追加探索</p>
            <p className="text-xs text-muted-foreground">
              キーワードや中心地点・半径を変えて、別の候補集合を探します。範囲内/範囲外の判定は中心地点「
              {area}」・半径{radiusLabel}基準のまま再計算されます。
            </p>
            <p className="text-xs text-muted-foreground">
              追加探索はクリック時のみ実行されます。API使用回数を抑えるため、自動では実行しません。
            </p>
          </div>

          {keywordChips.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">別キーワードで探す:</p>
              <div className="flex flex-wrap gap-1.5">
                {keywordChips.map((chip) => {
                  const runId = buildExplorationRunId(
                    "keyword",
                    chip,
                    area,
                    mainRadiusMeters,
                  );
                  return (
                    <Button
                      key={chip}
                      variant={exploredRunIds.has(runId) ? "ghost" : "outline"}
                      size="sm"
                      onClick={() => handleExplore("keyword", chip)}
                      disabled={
                        explorationPendingId !== null || exploredRunIds.has(runId)
                      }
                      className="gap-1.5"
                    >
                      {explorationPendingId === runId && <Spinner className="h-3 w-3" />}
                      {chip}
                      {exploredRunIds.has(runId) && (
                        <span className="text-xs text-muted-foreground">探索済み</span>
                      )}
                    </Button>
                  );
                })}
              </div>
            </div>
          )}

          {centerChips.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">周辺地点で探す:</p>
              <div className="flex flex-wrap gap-1.5">
                {centerChips.map((chip) => {
                  const runId = buildExplorationRunId(
                    "center",
                    keyword,
                    chip,
                    mainRadiusMeters,
                  );
                  return (
                    <Button
                      key={chip}
                      variant={exploredRunIds.has(runId) ? "ghost" : "outline"}
                      size="sm"
                      onClick={() => handleExplore("center", chip)}
                      disabled={
                        explorationPendingId !== null || exploredRunIds.has(runId)
                      }
                      className="gap-1.5"
                    >
                      {explorationPendingId === runId && <Spinner className="h-3 w-3" />}
                      {chip}
                      {exploredRunIds.has(runId) && (
                        <span className="text-xs text-muted-foreground">探索済み</span>
                      )}
                    </Button>
                  );
                })}
              </div>
            </div>
          )}

          {radiusChips.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">範囲を広げる:</p>
              <div className="flex flex-wrap gap-1.5">
                {radiusChips.map((chip) => {
                  const runId = buildExplorationRunId("radius", keyword, area, chip);
                  const label = `半径${formatDistanceMeters(chip)}`;
                  return (
                    <Button
                      key={chip}
                      variant={exploredRunIds.has(runId) ? "ghost" : "outline"}
                      size="sm"
                      onClick={() => handleExplore("radius", chip)}
                      disabled={
                        explorationPendingId !== null || exploredRunIds.has(runId)
                      }
                      className="gap-1.5"
                    >
                      {explorationPendingId === runId && <Spinner className="h-3 w-3" />}
                      {label}
                      {exploredRunIds.has(runId) && (
                        <span className="text-xs text-muted-foreground">探索済み</span>
                      )}
                    </Button>
                  );
                })}
              </div>
            </div>
          )}

          {explorationError && (
            <p role="alert" className="text-sm text-destructive">
              {explorationError}
            </p>
          )}

          {explorationRuns.length > 0 && (
            <div className="space-y-1 border-t border-border pt-2">
              <p className="text-xs font-medium text-foreground">探索履歴</p>
              <ul className="space-y-0.5 text-xs text-muted-foreground">
                {explorationRuns.map((run) => (
                  <li key={run.id}>
                    [{EXPLORATION_KIND_LABELS[run.kind]}] {run.keyword} /{" "}
                    {run.centerQuery} / 半径{formatDistanceMeters(run.radiusMeters)}:{" "}
                    {run.fetchedCount}件取得, 新規{run.addedUniqueCount}件 (重複
                    {run.duplicateCount}件), 登録候補{run.eligibleCount}件 / DB登録済み
                    {run.registeredCount}件
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-4 lg:items-start">
        {/* 地図: スマホでは一覧の上、PCでは右側に sticky 表示 */}
        <div className="order-1 lg:order-2 lg:sticky lg:top-4">
          <AreaSearchMap
            center={center}
            radiusMeters={mainRadiusMeters}
            places={displayedResults}
            addedIds={addedIds}
            activePlaceId={activePlaceId}
            onActivatePlace={setActivePlaceId}
          />
        </div>

        {/* 一覧 + 操作系: スマホでは地図の下、PCでは左側 */}
        <div className="order-2 lg:order-1 space-y-4">
          {allResults.length > 0 && (
            <div className="space-y-1">
              <Tabs
                value={resultFilter}
                onValueChange={(next) => setResultFilter(next as ResultFilter)}
                defaultValue="all"
                variant="pill"
              >
                <TabsList>
                  <TabsTrigger value="all">すべて</TabsTrigger>
                  <TabsTrigger value="eligible">登録候補のみ</TabsTrigger>
                  <TabsTrigger value="registered">DB登録済み</TabsTrigger>
                  <TabsTrigger value="inRange">範囲内のみ</TabsTrigger>
                </TabsList>
              </Tabs>
              <p className="text-xs text-muted-foreground">
                現在の表示: {RESULT_FILTER_LABELS[resultFilter]}{" "}
                {displayedResults.length}件
              </p>
            </div>
          )}

          {/* 0 件選択時のみ: 最初の一括選択への導線をリスト上部に残す (Option B)。
              下部バーは選択中のみ出るため、これが無いと最初に全選択する手段が消える。
              「DB登録済み」フィルタ表示中、または表示中に登録候補が無い場合は出さない。 */}
          {!showBar && resultFilter !== "registered" && displayedEligibleCount > 0 && (
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={handleSelectAll}>
                  表示中の登録候補を全選択
                </Button>
                <span className="text-sm text-muted-foreground">
                  登録したい店舗にチェックを入れてください
                </span>
              </div>
              <p className="text-xs text-muted-foreground">{selectAllHelperText}</p>
            </div>
          )}

          {/* error / bulkResult はバー外 (上部) に常駐させる。
              全件失敗時は handleBulkAdd が selectedIds を空にしてバーが消えるため、
              バー内に置くと結果表示ごと消えてしまう。 */}
          {error && (
            <div
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {error}
            </div>
          )}
          {/* bulkResult は全件失敗 (added === 0) の分岐でしか set されないため、
              失敗メッセージに固定し、role="alert" で確実に読み上げさせる。 */}
          {bulkResult && (
            <p className="text-sm text-destructive" role="alert">
              登録できませんでした（{bulkResult.failed}件失敗）
            </p>
          )}

          {/* バー表示中はリスト末尾に下部余白を足し、最後の数件が sticky バーの
              下に隠れてクリック/確認しづらくなるのを防ぐ。バー高さ + 余白の目安。 */}
          <div className={showBar ? "pb-20" : undefined}>
            {displayedResults.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {resultFilter === "eligible" ? (
                  nextPageToken ? (
                    <>
                      読み込み済み{loadedCount}件の中には、追加できる登録候補がありません。
                      <br />
                      DB登録済みの店舗が{registeredCount}件あります。
                      <br />
                      さらに未登録候補を探すには「さらに候補を読み込む」を押してください。
                    </>
                  ) : (
                    <>
                      読み込み済みの結果には、追加できる登録候補がありません。
                      <br />
                      条件を変えて再検索してください。
                    </>
                  )
                ) : resultFilter === "registered" ? (
                  "読み込み済みの結果には、DB登録済みの店舗はありません。"
                ) : resultFilter === "inRange" ? (
                  nextPageToken ? (
                    <>
                      読み込み済み{loadedCount}件の中には、半径{radiusLabel}
                      以内の店舗がありません。
                      <br />
                      範囲外の店舗が{outOfRangeCount}件あります。
                      <br />
                      さらに候補を読み込むと、範囲内の店舗が見つかる場合があります。
                    </>
                  ) : (
                    <>
                      読み込み済みの結果には、半径{radiusLabel}以内の店舗がありません。
                      <br />
                      中心地点・半径・キーワードを変えて再検索してください。
                    </>
                  )
                ) : (
                  "該当する店舗が見つかりませんでした。"
                )}
              </p>
            ) : (
              <PlaceResultList
                results={displayedResults}
                addedIds={addedIds}
                selectedIds={selectedIds}
                centerLabel={area}
                activePlaceId={activePlaceId}
                onActivatePlace={setActivePlaceId}
                onAdded={handleAdded}
                onToggle={handleToggle}
              />
            )}
          </div>

          {/* 「さらに候補を読み込む」: nextPageToken が存在する場合のみ表示。
              コスト管理のため自動取得は行わず、ユーザー操作時のみ追加 API 呼び出しを行う。
              取得分にも距離計算・範囲内外判定・DB登録済み判定・重複除去・地図ピン追加が
              同じ action (searchPlacesWithMatchesAction) 経由で適用される。 */}
          {nextPageToken && (
            <div className="flex flex-col items-center gap-2">
              <p className="text-sm text-muted-foreground">
                {eligibleCount === 0 && registeredCount > 0
                  ? "読み込み済み分は登録済みが中心です。未登録候補を探すには、さらに候補を読み込んで地図上でも確認してください。"
                  : "読み込み済みの中に登録候補が少ない場合は、さらに候補を読み込んで地図上でも確認できます。"}
              </p>
              <p className="text-xs text-muted-foreground">
                「さらに候補を読み込む」は同じ条件 ({keyword} / {area} / 半径
                {radiusLabel}) で次の検索結果を取得します。条件を変えて探すには上の「追加探索」を使ってください。
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={handleLoadMore}
                disabled={isLoadingMore}
                className="gap-1.5"
              >
                {isLoadingMore ? (
                  <>
                    <Spinner />
                    読み込み中…
                  </>
                ) : (
                  "さらに候補を読み込む"
                )}
              </Button>
              {loadMoreError && (
                <p role="alert" className="text-sm text-destructive">
                  {loadMoreError}
                </p>
              )}
            </div>
          )}

          {/* 下部固定バー: 1 件以上選択時のみ表示。
              sticky にすることでメインのコンテンツ幅に追従し、サイドバー折りたたみ (#106) でも
              左端がズレない。Topbar の sticky top-0 と同じ仕組みでビューポート基準に貼り付く。 */}
          {showBar && (
            <div
              role="region"
              aria-label="選択した店舗の一括操作"
              className="sticky bottom-0 z-30 flex flex-wrap items-center gap-2 border-t border-border bg-background/80 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md"
            >
              <Button variant="outline" size="sm" onClick={handleSelectAll}>
                表示中の登録候補を全選択
              </Button>
              <Button variant="ghost" size="sm" onClick={handleDeselectAll}>
                選択を解除
              </Button>
              <span className="text-sm text-muted-foreground" aria-live="polite">
                {selectedIds.size}件選択中
              </span>
              <Button
                variant="primary"
                size="sm"
                onClick={handleBulkAdd}
                disabled={isBulkPending}
                className="ml-auto gap-1.5"
              >
                {isBulkPending ? (
                  <>
                    <Spinner className="text-primary-foreground" />
                    登録中…
                  </>
                ) : (
                  "選択した店舗を登録"
                )}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
