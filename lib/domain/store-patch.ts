/**
 * 店舗詳細のインライン編集 (`updateStorePatchAction`) が受け付ける patch の許可リスト。
 *
 * Server Action の引数はブラウザから届く任意の値で、TypeScript の `StorePatch` 型は実行時に
 * 何も守らない。repository の `toDbPatch` は渡されたキーをそのまま列名として SET するため、
 * ここで絞らないと `tenant_id` / `id` / `created_at` / `basic_info` / `stage` など、どの画面も
 * この経路で編集しない列まで書き換えられる。
 *
 * 許可するのは、いまこの action を呼ぶ画面が実際に送る項目だけ (下の対応表)。
 * 1 つでも許可していないキーや不正な値があれば、patch 全体を拒否する (一部だけ保存しない)。
 *
 * | 呼び出し元 | 送る項目 |
 * | --- | --- |
 * | `store-title-section.tsx` (店舗名・業態) | name, genre |
 * | `basic-info-card.tsx` (基本情報) | prefecture, city, address, genre, channel, has_contact_form, contact_email, target_service, operator_type, operator_name, assigned_planner_user_id, assigned_sales_user_id |
 * | `map-embed-card.tsx` (地図) | lat, lng |
 * | `web-asset-card.tsx` (Web 資産) | map_url, site_url, instagram_url, phone |
 * | `research/[storeId]/sales-asset-section.tsx` (営業資産) | ai_analysis_result |
 *
 * 文字数の上限は業務上の規則ではなく、異常に大きな入力を弾くためのもの。既存の値を
 * そのまま送り返しても引っかからないよう、十分に大きくしてある。
 * 店舗名の前後の空白など、値の正規化はしない (これまでの保存内容を変えないため)。
 */
import { z } from "zod";
import { validateAiAnalysis } from "@/lib/ai/validate";
import { normalizeContactEmail } from "@/lib/domain/store-contact-email";
import {
  CHANNELS,
  CONTACT_FORMS,
  OPERATOR_TYPES,
  type StorePatch,
} from "@/types/store";

const SHORT_TEXT_MAX = 1_000;
const URL_TEXT_MAX = 4_096;

const shortText = z.string().max(SHORT_TEXT_MAX);
const urlText = z.string().max(URL_TEXT_MAX);
const oneOf = (values: readonly string[]) =>
  z.string().refine((value) => values.includes(value));
/** 未割当は null。基本情報カードは未割当を空文字で送るため、空文字も null として受ける。 */
const assignee = z
  .union([z.uuid(), z.literal(""), z.null()])
  .transform((value) => (value === "" ? null : value));
const coordinate = (limit: number) => z.number().min(-limit).max(limit).nullable();

const storePatchSchema = z.strictObject({
  name: shortText.refine((value) => value.trim() !== "", { message: "店舗名を入力してください" }),
  genre: shortText,
  prefecture: shortText,
  city: shortText,
  address: shortText,
  channel: oneOf(CHANNELS),
  has_contact_form: oneOf(CONTACT_FORMS),
  contact_email: z.unknown(),
  target_service: shortText,
  operator_type: oneOf(OPERATOR_TYPES),
  operator_name: shortText,
  assigned_planner_user_id: assignee,
  assigned_sales_user_id: assignee,
  lat: coordinate(90),
  lng: coordinate(180),
  map_url: urlText,
  site_url: urlText,
  instagram_url: urlText,
  phone: shortText,
  ai_analysis_result: z.unknown(),
}).partial();

/** 許可している項目の名前 (テストと PR の説明用)。 */
export const EDITABLE_STORE_PATCH_FIELDS = Object.keys(storePatchSchema.shape) as ReadonlyArray<
  keyof typeof storePatchSchema.shape
>;

export type ParsedStorePatch =
  | { ok: true; patch: StorePatch }
  | { ok: false; error: string; rejectedKeys: string[] };

const GENERIC_ERROR = "保存できない項目または値が含まれているため、保存しませんでした";

/**
 * ブラウザから届いた patch を検証し、DB に渡してよい `StorePatch` に変換する。
 * 値が `undefined` のキーは「変更しない」として落とす。エラー文言に入力値は含めない。
 */
export function parseStorePatch(raw: unknown): ParsedStorePatch {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: GENERIC_ERROR, rejectedKeys: [] };
  }
  // zod の strictObject は `__proto__` などのキーを未知のキーとして数えないため、
  // 自身のキーをすべて (Symbol も) 先に許可リストと照らす。
  const allowed: ReadonlySet<string> = new Set(EDITABLE_STORE_PATCH_FIELDS);
  const unknownKeys = Reflect.ownKeys(raw)
    .map(String)
    .filter((key) => !allowed.has(key));
  if (unknownKeys.length > 0) {
    return { ok: false, error: GENERIC_ERROR, rejectedKeys: unknownKeys };
  }
  const defined = Object.fromEntries(
    Object.entries(raw).filter(([, value]) => value !== undefined),
  );
  const parsed = storePatchSchema.safeParse(defined);
  if (!parsed.success) {
    const rejectedKeys = parsed.error.issues.flatMap((issue) =>
      issue.code === "unrecognized_keys" ? issue.keys : issue.path.map(String),
    );
    const nameIssue = parsed.error.issues.find(
      (issue) => issue.path[0] === "name" && issue.code === "custom",
    );
    return { ok: false, error: nameIssue?.message ?? GENERIC_ERROR, rejectedKeys };
  }

  const { contact_email, ai_analysis_result, ...rest } = parsed.data;
  const patch: StorePatch = { ...rest } as StorePatch;
  if (contact_email !== undefined) {
    const email = normalizeContactEmail(contact_email);
    if (!email.ok) return { ok: false, error: email.error, rejectedKeys: ["contact_email"] };
    patch.contact_email = email.value;
  }
  if (ai_analysis_result !== undefined) {
    if (ai_analysis_result === null) {
      patch.ai_analysis_result = null;
    } else {
      const ai = validateAiAnalysis(ai_analysis_result);
      if (!ai.ok) return { ok: false, error: GENERIC_ERROR, rejectedKeys: ["ai_analysis_result"] };
      patch.ai_analysis_result = ai.value;
    }
  }
  return { ok: true, patch };
}
