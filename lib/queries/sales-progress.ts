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

/**
 * `getAllProfiles` の引数形状は **`{ excludePlaceholders: false }` で固定**する。
 *
 * `'use cache'` のキャッシュキーは引数を含むため、同一リクエスト内の別の呼び出し元
 * (`app/(main)/stores/page.tsx` の `ProgressFilterBarSlot`) と形状が食い違うと
 * キーが割れ、コールド時に同じ SELECT が 2 回走る。
 * この一致は `lib/queries/__tests__/sales-progress.test.ts` で機械的に検証している。
 *
 * profiles を引数で受け取らないのは、既定値 (`= []`) を許すと呼び出し側の渡し忘れで
 * 全行の `salesName` が null になり、`applyProgressSort` の `case "sales"` が例外も
 * 型エラーも出さずタイブレーカへ落ちて「更新日降順」に無言で化けるため。
 */
export async function listSalesProgressRows(
  filter: SalesProgressFilter = {},
  sort: ProgressSort = DEFAULT_PROGRESS_SORT,
): Promise<SalesProgressRow[]> {
  const [stores, deals, profiles] = await Promise.all([
    listStores({}),
    listDealsCached(),
    getAllProfiles({ excludePlaceholders: false }),
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
