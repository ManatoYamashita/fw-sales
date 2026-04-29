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
