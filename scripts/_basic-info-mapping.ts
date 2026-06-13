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
 *
 * 以下スカラーは `BASIC_INFO_ITEMS` に対応キーがないため射影しない:
 * phone / review_avg / review_count / lat / lng
 *
 * task 4.1 (PR3b, 2026-06-13): `business_hours` スカラー列 DROP に伴い、
 * `business_hours_holidays` への射影を撤去 (basic_info 側の手動 / Places 充填に一本化)。
 *
 * 空値 (空文字 / 空白のみ) の項目は出力に含めない。
 * filled_by は常に `"manual"` (既存スカラーは手動編集の可能性が高く、以後の Places
 * 自動充填で破壊されないよう保護)。
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

  add("store_name", store.name);
  add("address", `${store.prefecture}${store.city}${store.address}`);
  add("cuisine_genre", store.genre);
  add("official_site", store.site_url);
  add("sns_accounts", store.instagram_url);

  return partial;
}
