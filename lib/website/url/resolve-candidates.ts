/**
 * Website root candidate 解決(Plan v1.1 §5、レビュー反映で候補 2 を削除）。pure function。
 *
 * Phase 1 の root candidate は `stores.site_url` のみ(契約 §B.4.1）。
 *
 * `basic_info.official_site` は絶対に参照しない(CC-1、契約 §B.3）。
 * `basic_info.official_site` は「公式サイト有無」の自由記述フィールドであり、
 * URL の供給源として扱ってはならない。この関数は入力型に `site_url` しか
 * 要求しないため、呼び出し側が `basic_info` を含むオブジェクトを渡しても
 * 構造的に読まれることはない。
 *
 * AI Research Source Registry(`source_type=official_site` かつ
 * `identity_status=target_match`)は PR #180 merge 後の追加候補(Phase 3)であり、
 * ここでは扱わない。
 *
 * 推測 URL の生成は行わない。
 */

import { canonicalizeUrl } from "./canonicalize";
import { classifyPortal } from "./portal";

export interface StoreUrlSource {
  site_url: string;
}

export type RootCandidateRejectionReason =
  | "empty"
  | "invalid_url"
  | "disallowed_scheme"
  | "credentials_in_url"
  | "portal_host";

export type ResolveRootCandidateResult =
  | { ok: true; url: string }
  | { ok: false; reason: RootCandidateRejectionReason };

/**
 * `stores.site_url` から root candidate を解決する。
 * 空文字(CC-2、未設定は null ではなく "" で表現される）は候補にしない。
 * portal(`./portal.ts`)を root candidate にはしない。
 *
 * 戻り値の URL の identity は常に `candidate_known_url` から始まる
 * (`contract/identity.ts` の `INITIAL_WEBSITE_IDENTITY_STATUS`）。trusted ではない。
 */
export function resolveRootCandidate(store: StoreUrlSource): ResolveRootCandidateResult {
  const raw = store.site_url.trim();
  if (raw === "") {
    return { ok: false, reason: "empty" };
  }

  const canon = canonicalizeUrl(raw);
  if (!canon.ok) {
    return { ok: false, reason: canon.reason };
  }

  const hostname = new URL(canon.url).hostname;
  if (classifyPortal(hostname) !== null) {
    return { ok: false, reason: "portal_host" };
  }

  return { ok: true, url: canon.url };
}
