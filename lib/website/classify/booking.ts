/**
 * Booking destination classifier(Plan v1.1 §9）。pure hostname/path classifier。
 *
 * `phone_only` は含めない(CC-3、契約 §B.3）。absence 判定を要するため、
 * deterministic extraction の範囲外。電話番号自体は `website_phone_links` が
 * 独立して保持する。
 *
 * first-party 判定は単純な string suffix ではなく、必ず dot boundary
 * (`lib/website/url/portal.ts` の `matchesDomain`）を用いる。PSL(Public Suffix List)
 * への依存は追加しない — origin 完全一致 + `.<effectiveHostname>` サフィックスのみで判定する。
 */

import { classifyPortal, matchesDomain, type PortalKind } from "../url/portal";

export const BOOKING_DESTINATION_TYPES = [
  "direct_first_party",
  "tabelog",
  "hotpepper",
  "gnavi",
  "retty",
  "tablecheck",
  "ebica",
  "ikyu",
  "ozmall",
  "google",
  "other_external",
  "unknown",
] as const;
export type BookingDestinationType = (typeof BOOKING_DESTINATION_TYPES)[number];

const PORTAL_TO_BOOKING_TYPE: Partial<Record<PortalKind, BookingDestinationType>> = {
  tabelog: "tabelog",
  hotpepper: "hotpepper",
  gnavi: "gnavi",
  retty: "retty",
  tablecheck: "tablecheck",
  ebica: "ebica",
  ikyu: "ikyu",
  ozmall: "ozmall",
  google: "google",
};

/** 予約 provider とみなす portal 種別(instagram/facebook/x/line 等の social は含まない）。 */
export const BOOKING_PROVIDER_PORTAL_KINDS: readonly PortalKind[] = Object.keys(
  PORTAL_TO_BOOKING_TYPE,
) as PortalKind[];

export interface ClassifiedBooking {
  destination_domain: string;
  destination_type: BookingDestinationType;
  /** 現状 destination_type と同値。将来 provider の表示名を分ける余地を残すためフィールドを分ける。 */
  provider: string;
}

/**
 * リンク 1 件を分類する。
 * 順序: 1. パース不能 → unknown  2. effectiveOrigin と同一 origin、または
 * そのサブドメイン → direct_first_party  3. 既知 portal → 対応する type
 * 4. それ以外の外部 host → other_external
 */
export function classifyBookingDestination(link: string, effectiveOrigin: string): ClassifiedBooking {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return { destination_domain: link, destination_type: "unknown", provider: "unknown" };
  }

  const host = url.hostname.toLowerCase();

  let effectiveHost: string | null = null;
  try {
    effectiveHost = new URL(effectiveOrigin).hostname.toLowerCase();
  } catch {
    effectiveHost = null;
  }

  if (effectiveHost !== null && (url.origin === effectiveOrigin || matchesDomain(host, effectiveHost))) {
    return { destination_domain: host, destination_type: "direct_first_party", provider: "direct_first_party" };
  }

  const portal = classifyPortal(host);
  if (portal !== null && portal in PORTAL_TO_BOOKING_TYPE) {
    const type = PORTAL_TO_BOOKING_TYPE[portal]!;
    return { destination_domain: host, destination_type: type, provider: type };
  }

  return { destination_domain: host, destination_type: "other_external", provider: "other_external" };
}

const TYPE_PRIORITY: Record<BookingDestinationType, number> = {
  direct_first_party: 0,
  tabelog: 1,
  hotpepper: 1,
  gnavi: 1,
  retty: 1,
  tablecheck: 1,
  ebica: 1,
  ikyu: 1,
  ozmall: 1,
  google: 1,
  other_external: 2,
  unknown: 3,
};

/**
 * 複数の予約リンクから代表値を 1 件選ぶ(§9.2）。「最も一次側に近いもの」を優先する
 * 決定的な選択(同順位なら入力の早い方を残す）。
 */
export function selectRepresentativeBooking(
  links: readonly string[],
  effectiveOrigin: string,
): ClassifiedBooking | null {
  if (links.length === 0) return null;
  const classified = links.map((l) => classifyBookingDestination(l, effectiveOrigin));
  return classified.reduce((best, cur) =>
    TYPE_PRIORITY[cur.destination_type] < TYPE_PRIORITY[best.destination_type] ? cur : best,
  );
}
