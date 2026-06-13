/**
 * PlaceCandidateRepository の Drizzle 実装 (エリア検索 候補DB保存の土台 / Issue #129 follow-up)
 *
 * `lib/repositories/place-candidate-repository.ts` の interface を Drizzle で 1:1 実装。
 *
 * 制約:
 * - `import "server-only"` を必ず付け、Client バンドルへの混入を防ぐ
 * - `upsertFromAreaSearch` は `google_place_id` ごとに select → insert/update の
 *   2ステップで構成する (firstSeenAt保持・seenCount加算・discoverySources統合・
 *   status保持といった「既存値を踏まえた更新」が必要なため、単純な
 *   `onConflictDoUpdate` では表現できない)
 * - 保存対象は `google_place_id` と探索メタ情報のみ。店舗名・住所・評価・電話番号等の
 *   Google由来コンテンツは保存しない
 *
 * 関連: lib/repositories/place-candidate-repository.ts, types/place-candidate.ts
 */

import "server-only";

import { eq } from "drizzle-orm";
import { db, type DbClient, type Tx } from "./client";
import { placeCandidates } from "./schema";
import type {
  PlaceCandidateRepository,
  UpsertPlaceCandidatesFromAreaSearchResult,
} from "@/lib/repositories/place-candidate-repository";
import type { PlaceCandidateStatus } from "@/types/place-candidate";
import { today } from "@/lib/utils/date";
import { generateId } from "@/lib/utils/id";

export function makePlaceCandidateRepo(
  executor: DbClient | Tx,
): PlaceCandidateRepository {
  return {
    async upsertFromAreaSearch({
      places,
      keyword,
      area,
      center,
      radiusMeters,
    }): Promise<UpsertPlaceCandidatesFromAreaSearchResult> {
      const now = today();
      let insertedCount = 0;
      let updatedCount = 0;
      let skippedCount = 0;

      for (const item of places) {
        const googlePlaceId = item.place.placeId;
        if (!googlePlaceId) {
          skippedCount++;
          continue;
        }

        const existingRows = await executor
          .select()
          .from(placeCandidates)
          .where(eq(placeCandidates.google_place_id, googlePlaceId))
          .limit(1);
        const existing = existingRows[0];

        const newSources = item.discovery.sources;
        const matchedStoreId = item.matchedStore?.id ?? null;

        if (!existing) {
          await executor.insert(placeCandidates).values({
            id: generateId("place_candidate"),
            google_place_id: googlePlaceId,
            status: "candidate",
            first_seen_at: now,
            last_seen_at: now,
            seen_count: 1,
            discovery_sources: [...newSources],
            last_searched_keyword: keyword,
            last_searched_area: area,
            last_center_lat: center.lat,
            last_center_lng: center.lng,
            last_radius_meters: radiusMeters,
            last_distance_meters: item.distanceMeters,
            last_is_within_radius: item.isWithinRadius,
            matched_store_id: matchedStoreId,
            created_at: now,
            updated_at: now,
          });
          insertedCount++;
          continue;
        }

        const mergedSources = Array.from(
          new Set([...existing.discovery_sources, ...newSources]),
        );
        // added/ignored は確定済みの状態のため、再検出で candidate に戻さない。
        const nextStatus: PlaceCandidateStatus =
          existing.status === "added" || existing.status === "ignored"
            ? (existing.status as PlaceCandidateStatus)
            : "candidate";

        await executor
          .update(placeCandidates)
          .set({
            last_seen_at: now,
            seen_count: existing.seen_count + 1,
            discovery_sources: mergedSources,
            last_searched_keyword: keyword,
            last_searched_area: area,
            last_center_lat: center.lat,
            last_center_lng: center.lng,
            last_radius_meters: radiusMeters,
            last_distance_meters: item.distanceMeters,
            last_is_within_radius: item.isWithinRadius,
            // null/空値で既存の有効値を不用意に消さない (details.ts の merge 方針に揃える)。
            matched_store_id: matchedStoreId ?? existing.matched_store_id,
            status: nextStatus,
            updated_at: now,
          })
          .where(eq(placeCandidates.google_place_id, googlePlaceId));
        updatedCount++;
      }

      return { insertedCount, updatedCount, skippedCount };
    },
  };
}

export const dbPlaceCandidateRepo: PlaceCandidateRepository =
  makePlaceCandidateRepo(db);
