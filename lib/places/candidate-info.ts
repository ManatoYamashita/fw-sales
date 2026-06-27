/**
 * `place_candidates` との照合結果 (`AreaSearchCandidateInfo`) のヘルパー (Issue #129 follow-up)
 */

import { formatDate } from "@/lib/utils/date";
import type { AreaSearchCandidateInfo, AreaSearchDiscoverySource, AreaSearchPlaceViewModel } from "./types";
import type { PlaceCandidate } from "@/types/place-candidate";

/** `PlaceCandidate` (DBレコード) を `AreaSearchCandidateInfo` (表示用) に変換する。 */
export function toAreaSearchCandidateInfo(candidate: PlaceCandidate): AreaSearchCandidateInfo {
  return {
    status: candidate.status,
    seenCount: candidate.seen_count,
    firstSeenAt: candidate.first_seen_at,
    lastSeenAt: candidate.last_seen_at,
    discoverySources: candidate.discovery_sources as AreaSearchDiscoverySource[],
  };
}

/**
 * `viewModels` の各要素に `google_place_id` (= `place.placeId`) が一致する
 * `candidates` の照合結果を `candidateInfo` として付与する。
 * 一致する候補が無い要素は `candidateInfo: null` のまま返す。
 * `viewModels` / `candidates` は変更しない。
 */
export function attachCandidateInfo(
  viewModels: readonly AreaSearchPlaceViewModel[],
  candidates: readonly PlaceCandidate[],
): AreaSearchPlaceViewModel[] {
  const byPlaceId = new Map(candidates.map((c) => [c.google_place_id, c]));

  return viewModels.map((vm) => {
    const candidate = byPlaceId.get(vm.place.placeId);
    return {
      ...vm,
      candidateInfo: candidate ? toAreaSearchCandidateInfo(candidate) : null,
    };
  });
}

/**
 * `candidateInfo` をカード表示用の1行テキストに変換する。
 * `candidateInfo === null` の場合は `null` (表示しない)。
 *
 * - `status` が `ignored`/`added`/`stale` の場合は status 表示を優先する
 *   (`seenCount` に関係なく固定文言)
 * - `status === "candidate"` の場合のみ `seenCount` で文言を分ける
 *   (今回保存後に再取得した結果、初めて見つかった店舗 (`seenCount === 1`) にも
 *   `candidateInfo` が付くため、「過去発見済み」とは表示しない)
 */
export function formatCandidateInfoLine(candidateInfo: AreaSearchCandidateInfo | null): string | null {
  if (!candidateInfo) return null;

  switch (candidateInfo.status) {
    case "ignored":
      return "過去に除外済み";
    case "added":
      return "候補DB: 追加済み";
    case "stale":
      return "候補DB: 期限切れ";
    case "candidate":
      if (candidateInfo.seenCount <= 1) {
        return "候補DB保存済み";
      }
      return `過去発見済み / 発見${candidateInfo.seenCount}回 / 最終発見: ${formatDate(candidateInfo.lastSeenAt)}`;
  }
}
