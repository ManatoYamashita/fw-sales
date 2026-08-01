export function today(): string {
  return new Date().toISOString().split("T")[0]!;
}

/** 現在時刻を ISO 8601 文字列 (timestamptz 列用) で返す。 */
export function nowIso(): string {
  return new Date().toISOString();
}

/** 指定タイムゾーンにおける当日を `YYYY-MM-DD` で返す。 */
export function todayInTimeZone(
  timeZone: string,
  now: Date = new Date(),
): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0]!;
}

export function formatDate(input: string | null | undefined): string {
  if (!input) return "—";
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return input;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}/${mm}/${dd}`;
}

/**
 * `YYYY-MM-DD` 形式かつ実在する日付かを検証する。
 * 形式チェックに加え、UTC で再構築した日付と一致するか照合することで
 * `2026-02-30` のような存在しない日付を拒否する (ローカルタイム非依存)。
 */
export function isValidYmd(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

export function diffDays(from: string, to: string = today()): number {
  const f = new Date(from).getTime();
  const t = new Date(to).getTime();
  return Math.floor((t - f) / 86400000);
}
