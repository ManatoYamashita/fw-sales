/**
 * 営業進捗一覧クエリ (customer-sales-progress-management)。
 *
 * キャッシュ済みの店舗一覧 / 商談一覧 / プロフィール一覧を合成し、
 * `lib/domain/sales-progress.ts` の純粋関数で行の導出・フィルタ・ソートを行う。
 * 合成元がそれぞれ `stores` / `deals` / `profiles` タグでキャッシュされているため、
 * 本モジュール自体は新しいタグや `'use cache'` を持たない。
 */
import "server-only";
import { listStores } from "./stores";
import { listDealsCached } from "./deals";
import { getAllProfiles } from "./profiles";
import { todayInTimeZone } from "@/lib/utils/date";
import {
  applyProgressFilter,
  applyProgressSort,
  buildSalesProgressRows,
  DEFAULT_PROGRESS_SORT,
  type ProgressSort,
  type SalesProgressFilter,
  type SalesProgressRow,
} from "@/lib/domain/sales-progress";

export async function listSalesProgressRows(
  filter: SalesProgressFilter = {},
  sort: ProgressSort = DEFAULT_PROGRESS_SORT,
): Promise<SalesProgressRow[]> {
  const [stores, deals, profiles] = await Promise.all([
    listStores({}),
    listDealsCached(),
    getAllProfiles(),
  ]);
  const profilesById = new Map(profiles.map((p) => [p.id, p.display_name]));
  const rows = buildSalesProgressRows(
    stores,
    deals,
    profilesById,
    todayInTimeZone("Asia/Tokyo"),
  );
  return applyProgressSort(applyProgressFilter(rows, filter), sort);
}
