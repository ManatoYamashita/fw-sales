/**
 * Deep Research キューページ (`/research`) で時刻列を表示するための純関数群。
 *
 * `lib/utils/date.ts` は絶対時刻のフォーマット (YYYY-MM-DD HH:mm) を担当、
 * 本ファイルは「N分前」「2h 13m」 などの相対表現を担当する。
 *
 * SSR/CSR 双方で動作。`now` を引数化することでテスト時に固定可能。
 */

const MILLIS_PER_SECOND = 1000;
const MILLIS_PER_MINUTE = 60 * MILLIS_PER_SECOND;
const MILLIS_PER_HOUR = 60 * MILLIS_PER_MINUTE;
const MILLIS_PER_DAY = 24 * MILLIS_PER_HOUR;

/**
 * ISO 8601 文字列を「いつ投入されたか」の相対表現に変換する。
 *
 * 表示ルール:
 * - 60 秒未満 → `<秒>秒前`
 * - 60 分未満 → `<分>分前`
 * - 24 時間未満 → `<時>時間前`
 * - それ以上 → `<日>日前`
 * - 未来時刻 (now より後) → `たった今`
 * - パース失敗 → `—`
 */
export function formatRelativeTime(
  iso: string | null | undefined,
  now: Date = new Date(),
): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const diffMs = now.getTime() - t;
  if (diffMs < 0) return "たった今";
  if (diffMs < MILLIS_PER_MINUTE) {
    return `${Math.floor(diffMs / MILLIS_PER_SECOND)}秒前`;
  }
  if (diffMs < MILLIS_PER_HOUR) {
    return `${Math.floor(diffMs / MILLIS_PER_MINUTE)}分前`;
  }
  if (diffMs < MILLIS_PER_DAY) {
    return `${Math.floor(diffMs / MILLIS_PER_HOUR)}時間前`;
  }
  return `${Math.floor(diffMs / MILLIS_PER_DAY)}日前`;
}

/**
 * 2 つの ISO 文字列の差分を「経過時間」として表現する。
 *
 * 表示ルール:
 * - どちらか null/不正 → `—`
 * - end < start → `—`
 * - 60 秒未満 → `<秒>s`
 * - 60 分未満 → `<分>m`
 * - 24 時間未満 → `<時>h <分>m` (分 == 0 なら `<時>h`)
 * - それ以上 → `<日>d <時>h` (時 == 0 なら `<日>d`)
 */
export function formatDuration(
  startIso: string | null | undefined,
  endIso: string | null | undefined,
): string {
  if (!startIso || !endIso) return "—";
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (Number.isNaN(start) || Number.isNaN(end)) return "—";
  const diffMs = end - start;
  if (diffMs < 0) return "—";
  return formatDurationMs(diffMs);
}

/**
 * `start` (ISO) から `now` までの経過時間。 in-flight ジョブの経過表示用。
 */
export function formatElapsed(
  startIso: string | null | undefined,
  now: Date = new Date(),
): string {
  if (!startIso) return "—";
  const start = Date.parse(startIso);
  if (Number.isNaN(start)) return "—";
  const diffMs = now.getTime() - start;
  if (diffMs < 0) return "—";
  return formatDurationMs(diffMs);
}

function formatDurationMs(diffMs: number): string {
  if (diffMs < MILLIS_PER_MINUTE) {
    return `${Math.floor(diffMs / MILLIS_PER_SECOND)}s`;
  }
  if (diffMs < MILLIS_PER_HOUR) {
    return `${Math.floor(diffMs / MILLIS_PER_MINUTE)}m`;
  }
  if (diffMs < MILLIS_PER_DAY) {
    const hours = Math.floor(diffMs / MILLIS_PER_HOUR);
    const minutes = Math.floor((diffMs % MILLIS_PER_HOUR) / MILLIS_PER_MINUTE);
    return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
  }
  const days = Math.floor(diffMs / MILLIS_PER_DAY);
  const hours = Math.floor((diffMs % MILLIS_PER_DAY) / MILLIS_PER_HOUR);
  return hours === 0 ? `${days}d` : `${days}d ${hours}h`;
}
