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
import type { Profile } from "@/types/profile";

/**
 * @param profiles 呼び出し側で一度だけ取得した profile 一覧を渡す。
 *        本関数内で `getAllProfiles` を独自に呼ばない (呼び出し元と引数形状が
 *        食い違うと `'use cache'` のキャッシュキーが割れ、同じ SELECT がコールド時に
 *        二重に走るため。呼び出し側 (`StoresTable`) と `getAllProfiles` 呼び出しを
 *        1 箇所に統一する)。
 */
export async function listSalesProgressRows(
  filter: SalesProgressFilter = {},
  sort: ProgressSort = DEFAULT_PROGRESS_SORT,
  profiles: readonly Profile[] = [],
): Promise<SalesProgressRow[]> {
  const [stores, deals] = await Promise.all([
    listStores({}),
    listDealsCached(),
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
