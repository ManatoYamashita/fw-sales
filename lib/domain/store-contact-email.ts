/** 契約連絡先メールの入力共通検証。Store 本体や AI 基本情報とは独立する。 */
export const CONTACT_EMAIL_MAX_LENGTH = 254;
/** RFC 5321 のローカル部 (@ より前) の上限。 */
const CONTACT_EMAIL_LOCAL_MAX_LENGTH = 64;

export const CONTACT_EMAIL_FORMAT_ERROR =
  "契約連絡先メールアドレスは、半角の「name@example.com」の形式 (254文字以内) で入力してください";

/**
 * ローカル部は RFC 5322 の dot-atom (先頭・末尾・連続のドットを許さない)。
 * ドメインは英数字とハイフンのラベルを 2 つ以上ドットでつないだもの (ブラウザの
 * `type="email"` と同じラベル規則に、「a@b」のようなドット無しを弾く条件を足した)。
 * 全角文字・空白・改行・制御文字・「<>()[],;:"\」はどこにも入らない。
 */
const LOCAL_PART = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const DOMAIN_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

export type NormalizedContactEmail =
  | { ok: true; value: string }
  | { ok: false; error: string };

/**
 * 前後の空白 (全角スペースを含む) を除いて検証する。空文字は「未登録」として受け付ける。
 * エラー文言には入力値を含めない (ログや画面に値を残さないため)。
 */
export function normalizeContactEmail(value: unknown): NormalizedContactEmail {
  if (typeof value !== "string") {
    return { ok: false, error: "契約連絡先メールアドレスが不正です" };
  }
  const normalized = value.trim();
  if (normalized === "") return { ok: true, value: "" };
  if (normalized.length > CONTACT_EMAIL_MAX_LENGTH || !isValidAddress(normalized)) {
    return { ok: false, error: CONTACT_EMAIL_FORMAT_ERROR };
  }
  return { ok: true, value: normalized };
}

function isValidAddress(address: string): boolean {
  const at = address.lastIndexOf("@");
  if (at <= 0) return false;
  const local = address.slice(0, at);
  const labels = address.slice(at + 1).split(".");
  return (
    local.length <= CONTACT_EMAIL_LOCAL_MAX_LENGTH &&
    LOCAL_PART.test(local) &&
    labels.length >= 2 &&
    labels.every((label) => DOMAIN_LABEL.test(label))
  );
}

/**
 * `mailto:` リンクの href。ローカル部に「?」「#」「%」などが入っていても、件名や本文の
 * 指定として解釈されないよう符号化する (RFC 6068)。ドメインは検証済みの英数字とハイフンだけ。
 */
export function contactEmailMailto(address: string): string {
  const at = address.lastIndexOf("@");
  return `mailto:${encodeURIComponent(address.slice(0, at))}@${address.slice(at + 1)}`;
}

/**
 * 店舗詳細・編集以外の画面 (一覧・パイプライン・ダッシュボード・AI 調査) へ渡す店舗から
 * 契約連絡先メールを外す。Server Component から Client Component へ渡す props は
 * ブラウザに届くため、表示しない画面にはアドレスを載せない。
 */
export function omitContactEmail<T extends { contact_email?: string }>(
  store: T,
): Omit<T, "contact_email"> {
  const rest = { ...store };
  delete rest.contact_email;
  return rest;
}
