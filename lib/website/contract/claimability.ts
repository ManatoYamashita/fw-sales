/**
 * Claimability の導出(Sales Diagnostics Data Contract v1.2 §A.5, §A.6）。
 *
 * signal 定義の既定値 × status × identity の最弱値(weakest wins）で最終
 * claimability を決定する。`observed` + `target_match`(または `trusted_manual`）
 * のときのみ FACT_SAFE に到達できる。
 *
 * ランクは global(契約 §A.5）の順序をそのまま用いる(`WEBSITE_CLAIMABILITY_RANK` は
 * `GLOBAL_CLAIMABILITY_RANK` から導出されており、独自定義ではない）。
 */

import {
  WEBSITE_CLAIMABILITIES,
  WEBSITE_CLAIMABILITY_RANK,
  type WebsiteClaimability,
  type WebsiteSignalStatus,
} from "./signal";
import { WEBSITE_IDENTITY_STATUSES, type WebsiteIdentityStatus } from "./identity";

const RANK = WEBSITE_CLAIMABILITY_RANK;

/** status ごとの claimability 上限(契約 §A.4）。 */
const BY_STATUS: Record<WebsiteSignalStatus, WebsiteClaimability> = {
  observed: "FACT_SAFE",
  not_observed: "INTERNAL_ONLY",
  inaccessible: "DO_NOT_USE",
};

/** identity ごとの claimability 上限(契約 §A.6）。 */
const BY_IDENTITY: Record<WebsiteIdentityStatus, WebsiteClaimability> = {
  target_match: "FACT_SAFE",
  trusted_manual: "FACT_SAFE",
  uncertain: "INTERNAL_ONLY",
  candidate_known_url: "INTERNAL_ONLY",
  unrelated: "DO_NOT_USE",
};

/** 与えられた claimability のうち、最も弱い(rank が最小の)値を返す。 */
export function weakest(...values: readonly WebsiteClaimability[]): WebsiteClaimability {
  if (values.length === 0) {
    throw new Error("weakest: 少なくとも1つの値が必要です");
  }
  return values.reduce((acc, v) => (RANK[v] < RANK[acc] ? v : acc));
}

/**
 * signal 定義の既定 claimability・status・identity から最終 claimability を導出する。
 * `candidate_known_url` / `uncertain` の identity では、status に関わらず
 * INTERNAL_ONLY 以下に留まる(FACT_SAFE には到達しない)。
 */
export function deriveClaimability(
  defaultClaimability: WebsiteClaimability,
  status: WebsiteSignalStatus,
  identity: WebsiteIdentityStatus,
): WebsiteClaimability {
  return weakest(defaultClaimability, BY_STATUS[status], BY_IDENTITY[identity]);
}

export { RANK as CLAIMABILITY_RANK };

/** 全 claimability / identity の網羅テストで使う一覧の re-export(便宜用）。 */
export const ALL_WEBSITE_CLAIMABILITIES = WEBSITE_CLAIMABILITIES;
export const ALL_WEBSITE_IDENTITY_STATUSES = WEBSITE_IDENTITY_STATUSES;
