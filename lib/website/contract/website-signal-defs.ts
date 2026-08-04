/**
 * Website Scanner V1 の formal signal 一覧(Sales Diagnostics Data Contract v1.2 §B.2）。
 * ちょうど 16 件。この配列が単一の Source of Truth であり、契約 document の
 * §B.2 の表と 1:1 対応する。
 */

import { STORAGE_POLICIES, type StoragePolicy } from "./global-signal";
import type { SignalValueType, WebsiteClaimability } from "./signal";

// storage policy は global 契約(§A.8）の一部。定義は `./global-signal.ts` にあり、
// ここでは利便のため re-export するのみ(Website 用に再定義していない）。
export { STORAGE_POLICIES };
export type { StoragePolicy };

export const WEBSITE_SIGNAL_KEYS = [
  "website_exists",
  "website_title",
  "website_meta_description",
  "website_h1",
  "website_canonical",
  "website_jsonld_types",
  "website_jsonld_name",
  "website_jsonld_address",
  "website_jsonld_phone",
  "website_phone_links",
  "website_instagram_links",
  "website_menu_links",
  "website_reservation_links",
  "website_booking_destination_domain",
  "website_booking_destination_type",
  "website_booking_provider",
] as const;
export type WebsiteSignalKey = (typeof WEBSITE_SIGNAL_KEYS)[number];

export interface WebsiteSignalDef {
  key: WebsiteSignalKey;
  value_type: Exclude<SignalValueType, "none">;
  default_claimability: WebsiteClaimability;
  storage_policy: StoragePolicy;
  description: string;
}

export const WEBSITE_SIGNAL_DEFS: readonly WebsiteSignalDef[] = [
  {
    key: "website_exists",
    value_type: "boolean",
    default_claimability: "FACT_SAFE",
    storage_policy: "persist_allowed",
    description: "root candidate の homepage が 2xx で取得できたか",
  },
  {
    key: "website_title",
    value_type: "string",
    default_claimability: "FACT_SAFE",
    storage_policy: "persist_allowed",
    description: "homepage <title> のテキスト",
  },
  {
    key: "website_meta_description",
    value_type: "string",
    default_claimability: "FACT_SAFE",
    storage_policy: "persist_allowed",
    description: "meta[name=description] または og:description",
  },
  {
    key: "website_h1",
    value_type: "string",
    default_claimability: "FACT_SAFE",
    storage_policy: "persist_allowed",
    description: "最初の <h1> テキスト",
  },
  {
    key: "website_canonical",
    value_type: "url",
    default_claimability: "INTERNAL_ONLY",
    storage_policy: "persist_allowed",
    description: "link[rel=canonical] href(未検証の技術メタデータ、営業トーク非対象）",
  },
  {
    key: "website_jsonld_types",
    value_type: "string_list",
    default_claimability: "INTERNAL_ONLY",
    storage_policy: "persist_allowed",
    description: "ページ内 JSON-LD の @type 全件(技術メタデータ）",
  },
  {
    key: "website_jsonld_name",
    value_type: "string",
    default_claimability: "FACT_SAFE",
    storage_policy: "persist_allowed",
    description: "identity-relevant JSON-LD node の name(strong 優先）",
  },
  {
    key: "website_jsonld_address",
    value_type: "string",
    default_claimability: "FACT_SAFE",
    storage_policy: "persist_allowed",
    description: "identity-relevant JSON-LD node の address(strong 優先）",
  },
  {
    key: "website_jsonld_phone",
    value_type: "string",
    default_claimability: "FACT_SAFE",
    storage_policy: "persist_allowed",
    description: "identity-relevant JSON-LD node の telephone(strong 優先）",
  },
  {
    key: "website_phone_links",
    value_type: "string_list",
    default_claimability: "FACT_SAFE",
    storage_policy: "persist_allowed",
    description: "a[href^=tel:] から抽出した電話番号一覧",
  },
  {
    key: "website_instagram_links",
    value_type: "url_list",
    default_claimability: "FACT_SAFE",
    storage_policy: "persist_allowed",
    description: "Instagram への canonical fact link 一覧(唯一の Instagram signal）",
  },
  {
    key: "website_menu_links",
    value_type: "url_list",
    default_claimability: "FACT_SAFE",
    storage_policy: "persist_allowed",
    description: "menu カテゴリに分類されたリンク一覧",
  },
  {
    key: "website_reservation_links",
    value_type: "url_list",
    default_claimability: "FACT_SAFE",
    storage_policy: "persist_allowed",
    description: "reserve カテゴリまたは予約 provider host に分類されたリンク一覧",
  },
  {
    key: "website_booking_destination_domain",
    value_type: "string",
    default_claimability: "FACT_SAFE",
    storage_policy: "persist_allowed",
    description: "予約リンクの代表 hostname",
  },
  {
    key: "website_booking_destination_type",
    value_type: "string",
    default_claimability: "FACT_SAFE",
    storage_policy: "persist_allowed",
    description: "予約リンクの代表 BookingDestinationType(phone_only を含まない、CC-3）",
  },
  {
    key: "website_booking_provider",
    value_type: "string",
    default_claimability: "FACT_SAFE",
    storage_policy: "persist_allowed",
    description: "予約リンクの代表 provider(現状 destination_type と同値）",
  },
];

export const WEBSITE_SIGNAL_DEFS_BY_KEY: ReadonlyMap<WebsiteSignalKey, WebsiteSignalDef> = new Map(
  WEBSITE_SIGNAL_DEFS.map((d) => [d.key, d]),
);

/**
 * `WEBSITE_SIGNAL_KEYS` との集合一致・重複無し・件数(16)を module load 時に自己検証する。
 * 契約 §B.2 の表と本配列の drift を、テスト実行を待たず import 時点で失敗させるため。
 */
function assertWellFormed(): void {
  const seen = new Set<string>();
  for (const def of WEBSITE_SIGNAL_DEFS) {
    if (seen.has(def.key)) {
      throw new Error(`WEBSITE_SIGNAL_DEFS: 重複した key "${def.key}"`);
    }
    seen.add(def.key);
  }
  if (seen.size !== WEBSITE_SIGNAL_KEYS.length) {
    throw new Error(
      `WEBSITE_SIGNAL_DEFS は WEBSITE_SIGNAL_KEYS と同数(${WEBSITE_SIGNAL_KEYS.length})でなければなりません(実際: ${seen.size})`,
    );
  }
  for (const key of WEBSITE_SIGNAL_KEYS) {
    if (!seen.has(key)) {
      throw new Error(`WEBSITE_SIGNAL_DEFS に key "${key}" の定義がありません`);
    }
  }
}
assertWellFormed();
