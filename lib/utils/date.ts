export function today(): string {
  return new Date().toISOString().split("T")[0]!;
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

export function diffDays(from: string, to: string = today()): number {
  const f = new Date(from).getTime();
  const t = new Date(to).getTime();
  return Math.floor((t - f) / 86400000);
}
