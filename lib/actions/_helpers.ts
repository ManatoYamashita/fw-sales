import "server-only";

export type ActionResult<T = void> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string };

export function success<T>(data: T, message?: string): ActionResult<T> {
  return message ? { ok: true, data, message } : { ok: true, data };
}

export function failure(error: string): ActionResult<never> {
  return { ok: false, error };
}

export function readString(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/**
 * FormData の name フィールドから文字列を読出し、空 / 未設定なら null を返す。
 * 担当者選択(user_id)のような「未割当」を NULL で表現するフィールド向け。
 */
export function readNullableString(
  formData: FormData,
  name: string,
): string | null {
  const value = formData.get(name);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function readNumber(
  formData: FormData,
  name: string,
  fallback = 0,
): number {
  const value = formData.get(name);
  if (typeof value !== "string" || value.trim() === "") return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function readNullableNumber(
  formData: FormData,
  name: string,
): number | null {
  const value = formData.get(name);
  if (typeof value !== "string" || value.trim() === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export function readBool(formData: FormData, name: string): boolean {
  return formData.get(name) === "on";
}
