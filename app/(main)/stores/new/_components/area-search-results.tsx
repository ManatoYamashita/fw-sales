"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Compass, MapPin, Search, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { PlaceResultList } from "./place-result-list";
import { AreaSearchMap } from "./area-search-map";
import {
  bulkAddStoresFromPlacesAction,
  searchNearbyPlacesWithMatchesAction,
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
import {
  AREA_SEARCH_SORT_MODES,
  AREA_SEARCH_SORT_MODE_LABELS,
  DEFAULT_AREA_SEARCH_SORT_MODE,
  isEligiblePlace,
  sortAreaSearchResults,
  type AreaSearchSortMode,
} from "@/lib/places/ranking";
import { buildTextSearchMeta, getAreaSearchMetaMessages } from "@/lib/places/search-meta";
import { Select } from "@/components/ui/select";
import type {
  AreaSearchDiscoverySource,
  AreaSearchMeta,
  AreaSearchPlaceViewModel,
  SearchCenter,
} from "@/lib/places/types";

/**
 * 一覧の絞り込み区分。
 * - `all`: 読み込み済み全件 (デフォルト)
 * - `eligible`: 一括追加対象になる「登録候補」(DB未登録 かつ 未追加)のみ
 * - `registered`: DB登録済みの店舗のみ
 * - `inRange`: 中心地点から半径内の店舗のみ
 */
type ResultFilter = "all" | "eligible" | "registered" | "inRange";

/** 探索履歴の種別。`ExplorationKind` (条件を変えて探す) + `nearby` (Nearby深掘り探索)。 */
type ExplorationRunKind = ExplorationKind | "nearby";

/** 「追加探索」1回分の実行記録 (画面内 state のみ。DB保存しない)。 */
interface ExplorationRun {
  id: string;
  kind: ExplorationRunKind;
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

const EXPLORATION_KIND_LABELS: Record<ExplorationRunKind, string> = {
  keyword: "別キーワード",
  center: "周辺地点",
  radius: "半径拡大",
  nearby: "Nearby深掘り",
};

/** 追加探索の種別ごとの discovery source。 */
const EXPLORATION_DISCOVERY_SOURCES: Record<ExplorationKind, AreaSearchDiscoverySource> = {
  keyword: "keywordExploration",
  center: "centerExploration",
  radius: "radiusExploration",
};

/** 結果ヘッダーの件数表示。Stat primitive はオーバースペックなので軽量版。 */
function MetricPill({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "primary" | "muted" | "success";
}) {
  const toneClass = {
    default: "bg-muted/40 text-foreground",
    primary: "bg-info-soft text-info",
    muted: "bg-muted/40 text-muted-foreground",
    success: "bg-success-soft text-success",
  }[tone];
  return (
    <div className="flex flex-col gap-0.5 rounded-md border border-border px-3 py-1.5">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span
        className={`inline-flex w-fit items-baseline gap-0.5 rounded px-1.5 py-0.5 text-sm font-semibold tabular-nums ${toneClass}`}
      >
        {value.toLocaleString()}
        <span className="text-[10px] font-normal opacity-70">件</span>
      </span>
    </div>
  );
}

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
  /** 初回検索のメタ情報 (取得元・上限件数・API回数目安など)。 */
  meta: AreaSearchMeta;
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
  meta: initialMeta,
}: AreaSearchResultsProps) {
  const [allResults, setAllResults] =
    useState<readonly AreaSearchPlaceViewModel[]>(results);
  const [nextPageToken, setNextPageToken] = useState<string | null>(
    initialNextPageToken,
  );
  // 検索状況メタ (取得元・上限件数・もっと読み込み可否・API回数目安)。
  // 「もっと読み込む」「追加探索」のたびに累積更新する。
  const [searchMeta, setSearchMeta] = useState<AreaSearchMeta>(initialMeta);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [isLoadingMore, startLoadMoreTransition] = useTransition();
  const [addedIds, setAddedIds] = useState<ReadonlySet<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [resultFilter, setResultFilter] = useState<ResultFilter>("all");
  const [sortMode, setSortMode] = useState<AreaSearchSortMode>(
    DEFAULT_AREA_SEARCH_SORT_MODE,
  );
  // 一覧カードのホバー/クリック、地図ピンのクリックで連動して強調する placeId。
  const [activePlaceId, setActivePlaceId] = useState<string | null>(null);
  // マップピン明示クリック時のみ、対応カードへスクロール + 2秒ハイライト。
  // カードホバーで毎回スクロールしないよう、active とは別の state で管理する。
  const [pinClickedPlaceId, setPinClickedPlaceId] = useState<string | null>(null);
  const pinClickClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handlePinClick = useCallback((placeId: string) => {
    setActivePlaceId(placeId);
    setPinClickedPlaceId(placeId);
    // DOM 反映後にスクロール (Suspense/初回マウントでも query が解決できるよう requestAnimationFrame)。
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(
        `[data-place-id="${CSS.escape(placeId)}"]`,
      );
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    if (pinClickClearTimer.current) clearTimeout(pinClickClearTimer.current);
    pinClickClearTimer.current = setTimeout(() => {
      setPinClickedPlaceId(null);
    }, 2000);
  }, []);
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
  // 連打や StrictMode の二重実行でも同一条件を重複実行しないよう、
  // state 反映を待たずに即時ロックする ref。
  const pendingExplorationRunIdsRef = useRef<Set<string>>(new Set());
  const exploredRunIdsRef = useRef<Set<string>>(new Set());
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
  const filteredResults =
    resultFilter === "eligible"
      ? allResults.filter((vm) => isEligiblePlace(vm, addedIds))
      : resultFilter === "registered"
        ? allResults.filter(({ matchedStore }) => matchedStore !== null)
        : resultFilter === "inRange"
          ? allResults.filter((vm) => vm.isWithinRadius)
          : allResults;

  // 表示順: フィルタ後の結果を sortMode に応じて並び替える (filter → sort)。
  const displayedResults = sortAreaSearchResults(
    filteredResults,
    sortMode,
    addedIds,
  );

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
      const merged = mergeUniquePlaces(allResults, result.data.places);
      setAllResults(merged);
      setNextPageToken(result.data.nextPageToken);
      setSearchMeta((prev) =>
        buildTextSearchMeta({
          loadedCount: merged.length,
          hasNextPage: result.data.meta.hasNextPage,
          currentPageCount: prev.currentPageCount + result.data.meta.currentPageCount,
          apiCallEstimate: prev.apiCallEstimate + result.data.meta.apiCallEstimate,
        }),
      );
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
    if (
      explorationPendingId ||
      pendingExplorationRunIdsRef.current.has(runId) ||
      exploredRunIdsRef.current.has(runId)
    ) {
      return;
    }

    setExplorationError(null);
    pendingExplorationRunIdsRef.current.add(runId);
    setExplorationPendingId(runId);
    // center 探索のみ中心地点を未指定にし、新たに resolveSearchCenter させる。
    // keyword/radius 探索はメイン中心地点をそのまま使い回す。
    const options = {
      ...(kind === "center" ? {} : { center }),
      discoverySource: EXPLORATION_DISCOVERY_SOURCES[kind],
    };

    startExplorationTransition(async () => {
      try {
        const result = await searchPlacesWithMatchesAction(
          explKeyword,
          explCenterQuery,
          explRadius,
          options,
        );

        if (!result.ok) {
          setExplorationError(result.error);
          return;
        }

        exploredRunIdsRef.current.add(runId);
        setExploredRunIds(new Set(exploredRunIdsRef.current));

        const fetchedCount = result.data.places.length;
        const recomputed = result.data.places.map((vm) =>
          recomputeViewModel(vm, center, explRadius),
        );

        // 半径拡大時は、既存結果も新半径基準で範囲内/範囲外を判定し直す。
        const base =
          kind === "radius"
            ? allResults.map((vm) => recomputeViewModel(vm, center, explRadius))
            : allResults;
        const { merged, addedCount, duplicateCount } = mergeUniquePlacesWithStats(
          base,
          recomputed,
        );
        const newlyAdded = merged.slice(merged.length - addedCount);

        setAllResults(merged);
        setSearchMeta((prev) =>
          buildTextSearchMeta({
            loadedCount: merged.length,
            hasNextPage:
              kind === "radius" ? result.data.meta.hasNextPage : prev.hasNextPage,
            currentPageCount: prev.currentPageCount + result.data.meta.currentPageCount,
            apiCallEstimate: prev.apiCallEstimate + result.data.meta.apiCallEstimate,
          }),
        );

        const newRun: ExplorationRun = {
          id: runId,
          kind,
          keyword: explKeyword,
          centerQuery: explCenterQuery,
          radiusMeters: explRadius,
          fetchedCount,
          addedUniqueCount: addedCount,
          duplicateCount,
          eligibleCount: newlyAdded.filter((vm) => isEligiblePlace(vm, addedIds)).length,
          registeredCount: newlyAdded.filter((vm) => vm.matchedStore !== null).length,
        };
        setExplorationRuns((runs) =>
          [newRun, ...runs.filter((run) => run.id !== runId)].slice(
            0,
            EXPLORATION_HISTORY_LIMIT,
          ),
        );

        // 新規取得を toast で即時フィードバック(営業担当の認知補助)。
        if (addedCount > 0) {
          toast.info(`追加探索: 新規${addedCount}件 (重複${duplicateCount}件)`);
        } else {
          toast.info(`追加探索: 新規はありません (重複${duplicateCount}件)`);
        }

        if (kind === "radius") {
          setMainRadiusMeters(explRadius);
          setNextPageToken(result.data.nextPageToken);
        }
      } finally {
        pendingExplorationRunIdsRef.current.delete(runId);
        setExplorationPendingId(null);
      }
    });
  };

  /**
   * 「Nearby深掘り探索」: ボタン押下時のみ実行する (自動実行はしない)。
   * メイン中心地点・メイン半径で Nearby Search を1回呼び出し、結果を既存結果に
   * `placeId` ベースでマージする (重複分は discovery.sources のみ統合)。
   * 同じ条件 (中心地点・半径) では再実行しない。
   */
  const handleNearbyExplore = () => {
    const runId = `nearby:${center.lat}:${center.lng}:${mainRadiusMeters}`;
    if (
      explorationPendingId ||
      pendingExplorationRunIdsRef.current.has(runId) ||
      exploredRunIdsRef.current.has(runId)
    ) {
      return;
    }

    setExplorationError(null);
    pendingExplorationRunIdsRef.current.add(runId);
    setExplorationPendingId(runId);

    startExplorationTransition(async () => {
      try {
        const result = await searchNearbyPlacesWithMatchesAction(center, mainRadiusMeters);

        if (!result.ok) {
          setExplorationError(result.error);
          return;
        }

        exploredRunIdsRef.current.add(runId);
        setExploredRunIds(new Set(exploredRunIdsRef.current));

        const fetchedCount = result.data.places.length;
        const recomputed = result.data.places.map((vm) =>
          recomputeViewModel(vm, center, mainRadiusMeters),
        );

        const { merged, addedCount, duplicateCount } = mergeUniquePlacesWithStats(
          allResults,
          recomputed,
        );
        const newlyAdded = merged.slice(merged.length - addedCount);

        setAllResults(merged);
        setSearchMeta((prev) =>
          buildTextSearchMeta({
            loadedCount: merged.length,
            hasNextPage: prev.hasNextPage,
            currentPageCount: result.data.places.length,
            apiCallEstimate: prev.apiCallEstimate + result.data.meta.apiCallEstimate,
          }),
        );

        const newRun: ExplorationRun = {
          id: runId,
          kind: "nearby",
          keyword,
          centerQuery: area,
          radiusMeters: mainRadiusMeters,
          fetchedCount,
          addedUniqueCount: addedCount,
          duplicateCount,
          eligibleCount: newlyAdded.filter((vm) => isEligiblePlace(vm, addedIds)).length,
          registeredCount: newlyAdded.filter((vm) => vm.matchedStore !== null).length,
        };
        setExplorationRuns((runs) =>
          [newRun, ...runs.filter((run) => run.id !== runId)].slice(
            0,
            EXPLORATION_HISTORY_LIMIT,
          ),
        );

        if (addedCount > 0) {
          toast.info(`Nearby深掘り: 新規${addedCount}件 (重複${duplicateCount}件)`);
        } else {
          toast.info(`Nearby深掘り: 新規はありません (重複${duplicateCount}件)`);
        }
      } finally {
        pendingExplorationRunIdsRef.current.delete(runId);
        setExplorationPendingId(null);
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

  const nearbyRunId = `nearby:${center.lat}:${center.lng}:${mainRadiusMeters}`;
  const hasNearbyRun = explorationRuns.some((run) => run.kind === "nearby");

  const keywordChips = suggestExplorationKeywords(keyword);
  const centerChips = suggestExplorationCenters(area);
  const radiusChips = suggestLargerRadii(mainRadiusMeters);
  const widerRadius = radiusChips[0];

  // 検索状況メタ (取得元・上限件数・もっと読み込み可否・API回数目安) の表示文言。
  // loadedCount は常に最新の読み込み済み件数 (allResults.length) を反映する。
  const metaMessages = getAreaSearchMetaMessages({ ...searchMeta, loadedCount });

  return (
    <div className="space-y-4">
      {/* 結果ヘッダー: 検索条件チップ + 件数メトリクス。
          「何を検索したか」「どれくらい取得して、何件が登録候補か」を一目で把握できる構成。 */}
      <div className="rounded-lg border border-border bg-card px-4 py-3 space-y-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
          <span className="text-xs text-muted-foreground">検索条件</span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-xs">
            <Search className="h-3 w-3 text-muted-foreground" />
            <span className="font-medium text-foreground">{keyword}</span>
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-xs">
            <MapPin className="h-3 w-3 text-muted-foreground" />
            <span className="font-medium text-foreground">{area}</span>
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-xs">
            <Compass className="h-3 w-3 text-muted-foreground" />
            <span className="font-medium text-foreground">{radiusLabel}</span>
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <MetricPill label="読み込み済み" value={loadedCount} />
          <MetricPill label="登録候補" value={eligibleCount} tone="primary" />
          <MetricPill label="DB登録済み" value={registeredCount} tone="muted" />
          <MetricPill label="追加済み" value={addedCount} tone="success" />
        </div>
        {(isSearchLimitReached || hasFewEligibleResults || explorationRuns.length > 0) && (
          <p className="text-xs text-muted-foreground border-t border-border pt-2">
            {isSearchLimitReached && (
              <>この条件は最大件数まで読み込み済みです。全店舗を保証するものではないため、条件を変えて追加探索してください。</>
            )}
            {!isSearchLimitReached && hasFewEligibleResults && (
              <>読み込み済みの登録候補が少なめです。下の「追加探索」で条件を変えて探してみてください。</>
            )}
            {explorationRuns.length > 0 && (
              <>
                {" "}重複除外 {totalDuplicateCount} 件。
              </>
            )}
          </p>
        )}
        {/* 検索状況メタ: 「探索の説明責任」のための小さな説明文 (Issue #129 follow-up)。
            取得元・上限件数・もっと読み込み可否・API回数目安・locationBiasの注意点を表示する。 */}
        <ul className="border-t border-border pt-2 space-y-0.5 text-xs text-muted-foreground">
          {metaMessages.map((message) => (
            <li key={message}>{message}</li>
          ))}
          <li>
            表示中の候補: {displayedResults.length.toLocaleString()}件
            {explorationRuns.length > 0 &&
              (hasNearbyRun
                ? " (追加探索・Nearby深掘りの結果を含みます)"
                : " (追加探索の結果を含みます)")}
          </li>
        </ul>
      </div>

      {/* Nearby深掘り探索: メイン中心地点・メイン半径で Nearby Search を1回呼び出し、
          既存結果に placeId ベースでマージする (ボタン押下時のみ実行、自動実行はしない)。 */}
      <div className="rounded-lg border border-border bg-card px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="space-y-0.5">
            <p className="text-sm font-medium text-foreground">Nearby深掘り探索</p>
            <p className="text-xs text-muted-foreground">
              近い飲食店をNearby Searchで追加取得します（API目安 +1回）
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleNearbyExplore}
            disabled={explorationPendingId !== null || exploredRunIds.has(nearbyRunId)}
            className="gap-1.5 shrink-0"
          >
            {explorationPendingId === nearbyRunId ? (
              <>
                <Spinner className="h-3 w-3" />
                探索中…
              </>
            ) : exploredRunIds.has(nearbyRunId) ? (
              "Nearby深掘り探索済み"
            ) : (
              "Nearby深掘り探索"
            )}
          </Button>
        </div>
        {explorationError && (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {explorationError}
          </p>
        )}
      </div>

      {/* 探索コントロール: 「さらに候補を読み込む」(同一条件の次ページ) と
          「追加探索」(条件を変えて別集合を探す) を 1 つの Card に統合し、
          Separator で区切って「結果の続き」と「条件を変えて探す」を明示する。
          チップ押下時のみ API を呼び出し、自動では実行しない。 */}
      {(nextPageToken ||
        keywordChips.length > 0 ||
        centerChips.length > 0 ||
        radiusChips.length > 0) && (
        <Card>
          <Card.Body className="space-y-3">
          {nextPageToken && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium text-foreground">結果の続き</p>
                  <p className="text-xs text-muted-foreground">
                    同じ条件 ({keyword} / {area} / 半径{radiusLabel}) で次の検索結果を取得します。
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleLoadMore}
                  disabled={isLoadingMore}
                  className="gap-1.5 shrink-0"
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
              </div>
              {loadMoreError && (
                <p role="alert" className="text-sm text-destructive">
                  {loadMoreError}
                </p>
              )}
            </div>
          )}

          {nextPageToken &&
            (keywordChips.length > 0 ||
              centerChips.length > 0 ||
              radiusChips.length > 0) && <Separator />}

          {(keywordChips.length > 0 ||
            centerChips.length > 0 ||
            radiusChips.length > 0) && (
          <div className="space-y-3">
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">条件を変えて探す</p>
            <p className="text-xs text-muted-foreground">
              キーワード・中心地点・半径を変えて別の候補集合を取得します。範囲内/範囲外の判定は「{area}」・半径{radiusLabel}基準のまま再計算されます。
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
          </div>
          )}

          {explorationRuns.length > 0 && (
            <details className="group rounded-md bg-muted/30 px-3 py-2">
              <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
                探索履歴 ({explorationRuns.length})
              </summary>
              <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
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
            </details>
          )}
          </Card.Body>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_400px] gap-4 lg:items-start">
        {/* 地図: スマホでは一覧の上、PCでは右側に sticky 表示 */}
        <div className="order-1 lg:order-2 lg:sticky lg:top-4">
          <AreaSearchMap
            center={center}
            radiusMeters={mainRadiusMeters}
            places={displayedResults}
            addedIds={addedIds}
            activePlaceId={activePlaceId}
            onActivatePlace={setActivePlaceId}
            onPinClick={handlePinClick}
          />
        </div>

        {/* 一覧 + 操作系: スマホでは地図の下、PCでは左側 */}
        <div className="order-2 lg:order-1 space-y-4">
          {allResults.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Tabs
                value={resultFilter}
                onValueChange={(next) => setResultFilter(next as ResultFilter)}
                defaultValue="all"
                variant="pill"
              >
                <TabsList>
                  <TabsTrigger value="all">すべて ({loadedCount})</TabsTrigger>
                  <TabsTrigger value="eligible">候補 ({eligibleCount})</TabsTrigger>
                  <TabsTrigger value="registered">登録済 ({registeredCount})</TabsTrigger>
                  <TabsTrigger value="inRange">範囲内 ({inRangeCount})</TabsTrigger>
                </TabsList>
              </Tabs>

              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                表示順
                <Select
                  value={sortMode}
                  onChange={(e) =>
                    setSortMode(e.target.value as AreaSearchSortMode)
                  }
                  className="h-8 w-auto text-xs"
                  aria-label="表示順を切り替え"
                >
                  {AREA_SEARCH_SORT_MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {AREA_SEARCH_SORT_MODE_LABELS[mode]}
                    </option>
                  ))}
                </Select>
              </label>
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
              <EmptyState
                icon={<SearchX />}
                title={
                  resultFilter === "eligible"
                    ? "追加できる登録候補がありません"
                    : resultFilter === "registered"
                      ? "DB登録済みの店舗はありません"
                      : resultFilter === "inRange"
                        ? `半径${radiusLabel}以内の店舗がありません`
                        : "該当する店舗が見つかりませんでした"
                }
                description={
                  resultFilter === "eligible"
                    ? nextPageToken
                      ? `読み込み済み${loadedCount}件のうちDB登録済が${registeredCount}件あります。さらに未登録候補を探すには「さらに候補を読み込む」を押してください。`
                      : "条件を変えて再検索するか、上の追加探索チップでキーワード/中心地点/半径を変えてください。"
                    : resultFilter === "registered"
                      ? "読み込み済みの結果にはDB登録済みの店舗はありません。"
                      : resultFilter === "inRange"
                        ? `範囲外の店舗が${outOfRangeCount}件あります。${nextPageToken ? "さらに候補を読み込むと範囲内の店舗が見つかる場合があります。" : "中心地点・半径・キーワードを変えて再検索してください。"}`
                        : "キーワード・中心地点・半径を変えて再検索してください。"
                }
                action={
                  resultFilter === "all" && widerRadius !== undefined ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleExplore("radius", widerRadius)}
                      disabled={explorationPendingId !== null}
                    >
                      半径を{formatDistanceMeters(widerRadius)}に広げて再検索
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <PlaceResultList
                results={displayedResults}
                addedIds={addedIds}
                selectedIds={selectedIds}
                centerLabel={area}
                activePlaceId={activePlaceId}
                pinClickedPlaceId={pinClickedPlaceId}
                onActivatePlace={setActivePlaceId}
                onAdded={handleAdded}
                onToggle={handleToggle}
              />
            )}
          </div>

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
