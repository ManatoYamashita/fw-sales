/**
 * Website Scanner V1 の DigitalSignal **subset**(Sales Diagnostics Data Contract v1.2 §B.1）。
 *
 * global な契約(status 5 値 / claimability 4 値 / SignalValue 8 型 / storage policy 4 値）は
 * `./global-signal.ts` にある。本 module はそこから Website Scanner V1 が実際に生成する
 * 値だけを取り出した subset であり、**global union の縮小ではない**(契約 §0 / §B.5）。
 *
 * 型名にはすべて `Website` 接頭辞を付けている。global に見える無印の名前
 * (`SignalStatus` / `DigitalSignalSchema` 等)を subset に割り当てると、将来
 * `absent_confirmed` を生成する collector が現れた際に contract drift を招くため。
 */

import { z } from "zod";
import {
  GLOBAL_CLAIMABILITY_RANK,
  SignalValueSchema,
  type GlobalClaimability,
  type GlobalSignalStatus,
} from "./global-signal";
import { WebsiteIdentityStatusSchema } from "./identity";

// SignalValue は global のまま使用する(契約 §B.1: 「そのまま採用」）。
export { SignalValueSchema };
export type { SignalValue, SignalValueType } from "./global-signal";

/**
 * Website Scanner V1 が生成する status(契約 §B.1）。**3 値。**
 * `not_applicable` / `absent_confirmed` は global(`GLOBAL_SIGNAL_STATUSES`）には
 * 存在するが、ここには含めない。型に含めないことで、誤って生成することを
 * コンパイル時に不可能にする(契約 §B.5、§CC-5）。
 */
export const WEBSITE_SIGNAL_STATUSES = [
  "observed",
  "not_observed",
  "inaccessible",
] as const satisfies readonly GlobalSignalStatus[];
export type WebsiteSignalStatus = (typeof WEBSITE_SIGNAL_STATUSES)[number];
export const WebsiteSignalStatusSchema = z.enum(WEBSITE_SIGNAL_STATUSES);

/**
 * Website Scanner V1 が生成する claimability(契約 §B.1）。**3 値。**
 * `QUESTION_ONLY` は global(`GLOBAL_CLAIMABILITIES`）には存在するが、Gap/Hypothesis
 * 推論を行わない本 collector は生成しない(契約 §A.5.1）。
 */
export const WEBSITE_CLAIMABILITIES = [
  "FACT_SAFE",
  "INTERNAL_ONLY",
  "DO_NOT_USE",
] as const satisfies readonly GlobalClaimability[];
export type WebsiteClaimability = (typeof WEBSITE_CLAIMABILITIES)[number];
export const WebsiteClaimabilitySchema = z.enum(WEBSITE_CLAIMABILITIES);

/**
 * Website subset の claimability ランク。global のランク(契約 §A.5）から
 * 該当する 3 値を取り出したものであり、独自に定義し直していない。
 */
export const WEBSITE_CLAIMABILITY_RANK: Record<WebsiteClaimability, number> = {
  DO_NOT_USE: GLOBAL_CLAIMABILITY_RANK.DO_NOT_USE,
  INTERNAL_ONLY: GLOBAL_CLAIMABILITY_RANK.INTERNAL_ONLY,
  FACT_SAFE: GLOBAL_CLAIMABILITY_RANK.FACT_SAFE,
};

/** DigitalSignal.provenance の固定値(契約 §A.7 / §B.1）。 */
export const WEBSITE_SCANNER_PROVENANCE = "website_scanner_v1" as const;

/**
 * Website Scanner V1 が生成する DigitalSignal(契約 §A.3 の subset）。
 * global 版は `GlobalDigitalSignalSchema`。
 */
export const WebsiteDigitalSignalSchema = z
  .object({
    key: z.string().min(1),
    value: SignalValueSchema,
    status: WebsiteSignalStatusSchema,
    identity: WebsiteIdentityStatusSchema,
    claimability: WebsiteClaimabilitySchema,
    provenance: z.literal(WEBSITE_SCANNER_PROVENANCE),
    source_urls: z.array(z.url()),
    observed_at: z.iso.datetime(),
  })
  .refine((s) => (s.status === "observed") === (s.value.type !== "none"), {
    message: "status と value.type の整合が取れていません(observed ⇔ value.type !== 'none')",
  });
export type WebsiteDigitalSignal = z.infer<typeof WebsiteDigitalSignalSchema>;
