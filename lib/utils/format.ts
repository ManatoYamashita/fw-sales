export function formatYen(n: number | null | undefined | string): string {
  if (n === null || n === undefined || n === "") return "—";
  const num = typeof n === "string" ? Number(n) : n;
  if (Number.isNaN(num)) return "—";
  return `¥${num.toLocaleString("ja-JP")}`;
}

export function csvToList(csv: string | null | undefined): string[] {
  if (!csv) return [];
  return csv
    .split(/[,、\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function listToCsv(list: readonly string[]): string {
  return list.filter(Boolean).join(",");
}
