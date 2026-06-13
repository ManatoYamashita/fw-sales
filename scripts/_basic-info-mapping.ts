/**
 * 既存スカラー → `basic_info` の射影純関数 (task 3.4 補助)
 *
 * `scripts/backfill-basic-info.ts` から分離した純関数。スクリプト本体は top-level で
 * `db`/`sql` を import し副作用を持つため、純関数を別ファイルにして vitest 環境から
 * 副作用なしで import できるようにする。
 */

import type { BasicInfo, BasicInfoField } from "@/types/basic-info";
import type { Store } from "@/types/store";
import { BASIC_INFO_ITEM_BY_KEY } from "@/lib/domain/basic-info-items";

/**
 * 既存スカラーから `basic_info` 部分更新を生成する純関数。
 *
 * 射影ルール:
 * - name                                    → store_name              (tier A)
 * - prefecture + city + address  (結合)      → address                 (tier A)
 * - genre                                   → cuisine_genre           (tier A)
 * - site_url                                → official_site           (tier A)
 * - instagram_url                           → sns_accounts            (tier A)
 * - phone                                   → phone                   (tier A、#134)
 * - review_avg (>0)                         → review_avg              (tier A、#134、小数第 1 位)
 * - review_count (>0)                       → review_count            (tier A、#134)
 *
 * 以下スカラーは `BASIC_INFO_ITEMS` に対応キーがないため射影しない: lat / lng
 *
 * task 4.1 (PR3b, 2026-06-13): `business_hours` スカラー列 DROP に伴い、
 * `business_hours_holidays` への射影を撤去 (basic_info 側の手動 / Places 充填に一本化)。
 * #134 (2026-06-13): phone / review_avg / review_count を一級市民化し射影に追加。
 *
 * 空値 (空文字 / 空白のみ / 数値 <= 0) の項目は出力に含めない。
 * filled_by は backfill 本体 (`mergeBasicInfo(..., "manual")`) が manual で最終確定するため、
 * 既存スカラーは手動編集の可能性が高い前提で保護される。新規店の最新 Places 値は
 * `placeResultToBasicInfo` が "places" 充填で別途担う。
 */
export function scalarToBasicInfo(
  store: Pick<
    Store,
    | "name"
    | "prefecture"
    | "city"
    | "address"
    | "genre"
    | "site_url"
    | "instagram_url"
    | "phone"
    | "review_avg"
    | "review_count"
  >,
  now: string,
): Partial<BasicInfo> {
  const partial: Partial<BasicInfo> = {};

  const add = (key: string, value: string) => {
    if (!BASIC_INFO_ITEM_BY_KEY.has(key)) return;
    const trimmed = value.trim();
    if (trimmed === "") return;
    const field: BasicInfoField = {
      value: trimmed,
      tier: "A",
      filled_by: "manual",
      updated_at: now,
    };
    partial[key] = field;
  };

  // 数値スカラー(review)用。0 / 負値(未評価)は射影しない("0.0 点 / 0 件" の混入を防ぐ)。
  const addNumber = (key: string, value: number) => {
    if (value <= 0) return;
    add(key, key === "review_avg" ? value.toFixed(1) : String(value));
  };

  add("store_name", store.name);
  add("address", `${store.prefecture}${store.city}${store.address}`);
  add("cuisine_genre", store.genre);
  add("official_site", store.site_url);
  add("sns_accounts", store.instagram_url);
  add("phone", store.phone);
  addNumber("review_avg", store.review_avg);
  addNumber("review_count", store.review_count);

  return partial;
}
