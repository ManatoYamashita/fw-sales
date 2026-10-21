/** 契約連絡先メールの入力共通検証。Store 本体や AI 基本情報とは独立する。 */
export const CONTACT_EMAIL_MAX_LENGTH = 254;

export type NormalizedContactEmail =
  | { ok: true; value: string }
  | { ok: false; error: string };

export function normalizeContactEmail(value: unknown): NormalizedContactEmail {
  if (typeof value !== "string") {
    return { ok: false, error: "契約連絡先メールアドレスが不正です" };
  }
  const normalized = value.trim();
  if (normalized === "") return { ok: true, value: "" };
  if (normalized.length > CONTACT_EMAIL_MAX_LENGTH || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/u.test(normalized)) {
    return { ok: false, error: "契約連絡先メールアドレスの形式を確認してください" };
  }
  return { ok: true, value: normalized };
}
