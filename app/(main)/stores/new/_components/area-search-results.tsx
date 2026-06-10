"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { PlaceResultList } from "./place-result-list";
import {
  bulkAddStoresFromPlacesAction,
  searchPlacesWithMatchesAction,
} from "@/lib/actions/area-search-actions";
import { mergeUniquePlaces } from "@/lib/places/bulk-utils";
import type { PlaceWithMatch } from "@/lib/places/types";

/**
 * 一覧の絞り込み区分。
 * - `all`: 読み込み済み全件 (デフォルト)
 * - `eligible`: 一括追加対象になる「登録候補」(DB未登録 かつ 未追加)のみ
 * - `registered`: DB登録済みの店舗のみ
 */
type ResultFilter = "all" | "eligible" | "registered";

const RESULT_FILTER_LABELS: Record<ResultFilter, string> = {
  all: "すべて",
  eligible: "登録候補のみ",
  registered: "DB登録済み",
};

export interface AreaSearchResultsProps {
  results: readonly PlaceWithMatch[];
  /** 初回検索の `nextPageToken`。次ページが無い場合は null。 */
  nextPageToken: string | null;
  /** 「もっと読み込む」で同じ条件を再送するための初回検索キーワード。 */
  keyword: string;
  /** 「もっと読み込む」で同じ条件を再送するための初回検索エリア。 */
  area: string;
}

/**
 * エリア検索結果の一覧 + 一括登録コントロール。
 * 親の `AreaSearchPanel` から検索結果を受け取り、選択/登録/追加ページ読込の状態は
 * 内部で完結する。再検索のたびに親側で `key` を変えて再マウントする想定 (state は
 * 初回 props のみを初期値として持ち、以後は内部で更新する)。
 */
export function AreaSearchResults({
  results,
  nextPageToken: initialNextPageToken,
  keyword,
  area,
}: AreaSearchResultsProps) {
  const [allResults, setAllResults] = useState<readonly PlaceWithMatch[]>(results);
  const [nextPageToken, setNextPageToken] = useState<string | null>(
    initialNextPageToken,
  );
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [isLoadingMore, startLoadMoreTransition] = useTransition();
  const [addedIds, setAddedIds] = useState<ReadonlySet<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [resultFilter, setResultFilter] = useState<ResultFilter>("all");
  // bulkResult は全件失敗 (added === 0) のときだけ set される失敗専用の結果。
  const [bulkResult, setBulkResult] = useState<{ failed: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBulkPending, startBulkTransition] = useTransition();
  const router = useRouter();

  const handleLoadMore = () => {
    if (!nextPageToken) return;
    setLoadMoreError(null);
    startLoadMoreTransition(async () => {
      const result = await searchPlacesWithMatchesAction(
        keyword,
        area,
        nextPageToken,
      );
      if (!result.ok) {
        setLoadMoreError(result.error);
        return;
      }
      setAllResults((prev) => mergeUniquePlaces(prev, result.data.places));
      setNextPageToken(result.data.nextPageToken);
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
    const eligible = allResults
      .filter(
        ({ place, matchedStore }) =>
          matchedStore === null && !addedIds.has(place.placeId),
      )
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

  const showBar = selectedIds.size >= 1;
  // 件数サマリー (営業担当が「取りこぼしていないか」を把握するための指標)。
  const loadedCount = allResults.length;
  const registeredCount = allResults.filter(
    ({ matchedStore }) => matchedStore !== null,
  ).length;
  const addedCount = allResults.filter(({ place }) =>
    addedIds.has(place.placeId),
  ).length;
  // 上部「全選択」導線を出すか: 登録可能 (DB 未登録 かつ 未追加) な候補が残っている場合のみ。
  const eligibleCount = allResults.filter(
    ({ place, matchedStore }) =>
      matchedStore === null && !addedIds.has(place.placeId),
  ).length;

  // 一覧の絞り込み。matchedStore は検索時点のDB照合結果のスナップショットのため、
  // 画面内で追加済み (addedIds) になった店舗も matchedStore === null のままだが、
  // 「DB照合時点では未登録だった」という意味で「登録候補のみ」からは除外する
  // (addedIds.has で判定)。登録済み店舗はもともと選択不可のため、
  // 選択状態 (selectedIds/addedIds) には影響しない。
  const displayedResults =
    resultFilter === "eligible"
      ? allResults.filter(
          ({ place, matchedStore }) =>
            matchedStore === null && !addedIds.has(place.placeId),
        )
      : resultFilter === "registered"
        ? allResults.filter(({ matchedStore }) => matchedStore !== null)
        : allResults;

  return (
    <div className="space-y-4">
      {/* 検索条件・取得状況・件数サマリー: 「どこまで取得済みか」「取りこぼしていないか」の不安を減らす */}
      <div className="rounded-md border border-border bg-muted/30 px-4 py-3 text-sm space-y-1">
        <p className="text-foreground">
          検索条件: <span className="font-medium">{keyword}</span>
          {area.trim() && (
            <>
              {" "}
              / <span className="font-medium">{area}</span>
            </>
          )}
        </p>
        <p className="text-muted-foreground">
          Google Placesの検索結果から、読み込み済み {loadedCount}件を表示しています。
        </p>
        <p className="text-muted-foreground">
          登録候補 {eligibleCount}件 / DB登録済み {registeredCount}件 / 追加済み{" "}
          {addedCount}件
        </p>
        <p className="text-xs text-muted-foreground">
          ※ この検索はGoogle Placesのテキスト検索結果です。厳密な半径検索や距離順ではありません。
        </p>
      </div>

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
            </TabsList>
          </Tabs>
          <p className="text-xs text-muted-foreground">
            現在の表示: {RESULT_FILTER_LABELS[resultFilter]} {displayedResults.length}件
          </p>
        </div>
      )}

      {/* 0 件選択時のみ: 最初の一括選択への導線をリスト上部に残す (Option B)。
          下部バーは選択中のみ出るため、これが無いと最初に全選択する手段が消える。
          「DB登録済み」フィルタ表示中は一括追加対象が無いため出さない。 */}
      {!showBar && resultFilter !== "registered" && eligibleCount > 0 && (
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleSelectAll}>
              登録候補を全選択
            </Button>
            <span className="text-sm text-muted-foreground">
              登録したい店舗にチェックを入れてください
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            読み込み済みの登録候補が対象です。まだ読み込んでいない候補は対象外です。
          </p>
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
            ) : (
              "該当する店舗が見つかりませんでした。"
            )}
          </p>
        ) : (
          <PlaceResultList
            results={displayedResults}
            addedIds={addedIds}
            selectedIds={selectedIds}
            onAdded={handleAdded}
            onToggle={handleToggle}
          />
        )}
      </div>

      {/* 「さらに候補を読み込む」: nextPageToken が存在する場合のみ表示。
          コスト管理のため自動取得は行わず、ユーザー操作時のみ追加 API 呼び出しを行う。 */}
      {nextPageToken && (
        <div className="flex flex-col items-center gap-2">
          <p className="text-sm text-muted-foreground">
            {eligibleCount === 0 && registeredCount > 0
              ? "読み込み済み分は登録済みが中心です。未登録候補を探すには、さらに候補を読み込んでください。"
              : "読み込み済みの中に登録候補が少ない場合は、さらに候補を読み込んで確認できます。"}
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
            登録候補を全選択
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
  );
}
