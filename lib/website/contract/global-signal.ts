/**
 * Sales Diagnostics **Global** Contract(Sales Diagnostics Data Contract v1.2 Part A）。
 *
 * この module は Sales Diagnostics 全体に適用される契約であり、Website Scanner 固有では
 * ない。Website Scanner V1 が使用する subset は `./signal.ts`(`Website*` 接頭辞）である。
 *
 * **Part A と Part B を混同しないこと。** ある collector が特定の値を生成しないことは、
 * その値を global union から削除する理由にならない(契約 §0 / §A.5.1 / §A.9）。
 * 本 module は「削除していないこと」をコード上でも構造的に検証可能にするために存在する。
 *
 * 配置について: 現時点で collector は Website Scanner のみのため `lib/website/contract/` に
 * 置いている。2 つ目の collector が追加される時点で、collector 非依存の場所
 * (`lib/contract/` 等）へ移動すること(契約 §C）。
 */

import { z } from "zod";

/**
 * 全観測値の表現(契約 §A.2）。**8 variants。**
 * Website Scanner V1 は `number` / `date` を実際には生成しないが、global の型からは
 * 削除しない(他の collector が使用しうる）。
 */
export const SignalValueSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("boolean"), value: z.boolean() }),
  z.object({ type: z.literal("string"), value: z.string() }),
  z.object({ type: z.literal("number"), value: z.number().finite() }),
  z.object({ type: z.literal("url"), value: z.url() }),
  z.object({ type: z.literal("date"), value: z.iso.date() }),
  z.object({ type: z.literal("string_list"), value: z.array(z.string()) }),
  z.object({ type: z.literal("url_list"), value: z.array(z.url()) }),
  z.object({ type: z.literal("none") }),
]);
export type SignalValue = z.infer<typeof SignalValueSchema>;
export type SignalValueType = SignalValue["type"];

/**
 * status の global union(契約 §A.4）。**5 値。**
 * `not_applicable` / `absent_confirmed` は Website Scanner V1 が生成しないだけであり
 * (契約 §B.5、§CC-5）、契約からは削除されていない。
 */
export const GLOBAL_SIGNAL_STATUSES = [
  "observed",
  "not_observed",
  "inaccessible",
  "not_applicable",
  "absent_confirmed",
] as const;
export type GlobalSignalStatus = (typeof GLOBAL_SIGNAL_STATUSES)[number];
export const GlobalSignalStatusSchema = z.enum(GLOBAL_SIGNAL_STATUSES);

/**
 * claimability の global union(契約 §A.5）。**4 値。**
 * `QUESTION_ONLY` は Opportunity Engine が Question オブジェクトへ付与する値であり、
 * Fact 層の collector は生成しない(契約 §A.5.1）。型からは削除しない。
 */
export const GLOBAL_CLAIMABILITIES = [
  "FACT_SAFE",
  "QUESTION_ONLY",
  "INTERNAL_ONLY",
  "DO_NOT_USE",
] as const;
export type GlobalClaimability = (typeof GLOBAL_CLAIMABILITIES)[number];
export const GlobalClaimabilitySchema = z.enum(GLOBAL_CLAIMABILITIES);

/**
 * claimability のランク(契約 §A.5）: `DO_NOT_USE < INTERNAL_ONLY < QUESTION_ONLY < FACT_SAFE`。
 * 複数要因の合成は「最も弱い値を採る」(weakest wins）。
 */
export const GLOBAL_CLAIMABILITY_RANK: Record<GlobalClaimability, number> = {
  DO_NOT_USE: 0,
  INTERNAL_ONLY: 1,
  QUESTION_ONLY: 2,
  FACT_SAFE: 3,
};

/**
 * identity status の global パターン(契約 §A.6）。**5 値。**
 * URL / 外部ソースに基づいて観測を行うあらゆる collector が採用しうる汎用 trust boundary。
 */
export const GLOBAL_IDENTITY_STATUSES = [
  "candidate_known_url",
  "trusted_manual",
  "target_match",
  "uncertain",
  "unrelated",
] as const;
export type GlobalIdentityStatus = (typeof GLOBAL_IDENTITY_STATUSES)[number];
export const GlobalIdentityStatusSchema = z.enum(GLOBAL_IDENTITY_STATUSES);

/**
 * signal **定義**(instance ではなく型)の storage policy(契約 §A.8）。**4 値。**
 * 「今実装が永続化するか」とは独立したデータガバナンス上の宣言である。
 */
export const STORAGE_POLICIES = [
  "persist_allowed",
  "read_through_only",
  "derived_existing_only",
  "prohibited",
] as const;
export type StoragePolicy = (typeof STORAGE_POLICIES)[number];

/**
 * DigitalSignal の global 形状(契約 §A.3）。
 *
 * `provenance` は「どの collector / stage が生成したか」を表す任意の識別子文字列
 * (契約 §A.7）。Website Scanner V1 はこれを `"website_scanner_v1"` に固定した
 * subset schema(`WebsiteDigitalSignalSchema`）を用いる。
 *
 * 不変条件(契約 §A.3）: `status === "observed"` **であるとき、かつそのときのみ**
 * `value.type !== "none"`。
 */
export const GlobalDigitalSignalSchema = z
  .object({
    key: z.string().min(1),
    value: SignalValueSchema,
    status: GlobalSignalStatusSchema,
    identity: GlobalIdentityStatusSchema,
    claimability: GlobalClaimabilitySchema,
    provenance: z.string().min(1),
    source_urls: z.array(z.url()),
    observed_at: z.iso.datetime(),
  })
  .refine((s) => (s.status === "observed") === (s.value.type !== "none"), {
    message: "status と value.type の整合が取れていません(observed ⇔ value.type !== 'none')",
  });
export type GlobalDigitalSignal = z.infer<typeof GlobalDigitalSignalSchema>;
