/**
 * Website Scanner V1 の identity trust boundary(Sales Diagnostics Data Contract v1.2 §A.6, §B.4）。
 *
 * homepage 取得成功 ≠ 対象店舗公式サイト、same-origin ≠ target identity、を
 * 型レベルで分離するための 5 値。判定ロジック自体(Phase 3)はこのファイルに含まない。
 * ここでは identity status の型と、evidence 抽出(Phase 1)で使う型のみを定義する。
 */

import { z } from "zod";
import { GLOBAL_IDENTITY_STATUSES, type GlobalIdentityStatus } from "./global-signal";

/**
 * Website Scanner は global の 5 値(`GLOBAL_IDENTITY_STATUSES`、契約 §A.6）を
 * そのまま採用する(status / claimability と異なり subset ではない）。
 * ただし `trusted_manual` は V1 の実行経路では到達不能(契約 §CC-4）。
 */
export const WEBSITE_IDENTITY_STATUSES = [
  "candidate_known_url",
  "trusted_manual",
  "target_match",
  "uncertain",
  "unrelated",
] as const satisfies readonly GlobalIdentityStatus[];
export type WebsiteIdentityStatus = (typeof WEBSITE_IDENTITY_STATUSES)[number];
export const WebsiteIdentityStatusSchema = z.enum(WEBSITE_IDENTITY_STATUSES);

/** global の 5 値と過不足なく一致することを起動時に検証する(契約 §A.6 との drift 検出）。 */
if (
  WEBSITE_IDENTITY_STATUSES.length !== GLOBAL_IDENTITY_STATUSES.length ||
  !GLOBAL_IDENTITY_STATUSES.every((s) => (WEBSITE_IDENTITY_STATUSES as readonly string[]).includes(s))
) {
  throw new Error("WEBSITE_IDENTITY_STATUSES は GLOBAL_IDENTITY_STATUSES と一致していなければなりません");
}

/**
 * root candidate 解決直後、まだページ内容と照合していない初期状態(契約 §B.4.1）。
 * `resolveRootCandidate`(`lib/website/url/resolve-candidates.ts`）が返す URL の
 * identity は常にこの値から始まり、trusted ではない
 * (`deriveClaimability` により FACT_SAFE には到達しない、契約 §A.6）。
 */
export const INITIAL_WEBSITE_IDENTITY_STATUS: WebsiteIdentityStatus = "candidate_known_url";

/**
 * `trusted_manual` は契約 §A.6 / §CC-4 により、人間の明示的操作によってのみ到達する。
 * Website Scanner V1 には該当する UI が存在しないため、この定数を実際に代入する
 * コード経路は存在しない(到達不能であることの逆引き用マーカー、テスト用）。
 */
export const TRUSTED_MANUAL_WEBSITE_IDENTITY_STATUS: WebsiteIdentityStatus = "trusted_manual";

export const EVIDENCE_STRENGTHS = ["strong", "weak"] as const;
export type EvidenceStrength = (typeof EVIDENCE_STRENGTHS)[number];

/**
 * identity evidence 候補の供給源(契約 §B.4.2）。
 * - `json_ld_strong_entity`: Restaurant/LocalBusiness 等の店舗 entity 系 JSON-LD
 * - `json_ld_organization`: Organization の JSON-LD(運営会社名、weak 固定）
 * - `h1` / `title`: 構造化されていない自由記述(weak、name のみ）
 * - `tel_link`: `tel:` リンク(weak、phone のみ）
 */
export const IDENTITY_CANDIDATE_PROVENANCES = [
  "json_ld_strong_entity",
  "json_ld_organization",
  "h1",
  "title",
  "tel_link",
] as const;
export type IdentityCandidateProvenance = (typeof IDENTITY_CANDIDATE_PROVENANCES)[number];

export const IdentityCandidateSchema = z.object({
  value: z.string().min(1),
  strength: z.enum(EVIDENCE_STRENGTHS),
  source_url: z.url(),
  provenance: z.enum(IDENTITY_CANDIDATE_PROVENANCES),
});
export type IdentityCandidate = z.infer<typeof IdentityCandidateSchema>;

export const WebsiteIdentityEvidenceSchema = z.object({
  names: z.array(IdentityCandidateSchema),
  addresses: z.array(IdentityCandidateSchema),
  phones: z.array(IdentityCandidateSchema),
});
export type WebsiteIdentityEvidence = z.infer<typeof WebsiteIdentityEvidenceSchema>;

export const EMPTY_IDENTITY_EVIDENCE: WebsiteIdentityEvidence = {
  names: [],
  addresses: [],
  phones: [],
};
