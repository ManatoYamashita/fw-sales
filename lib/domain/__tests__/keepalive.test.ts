/**
 * keepalive 鮮度判定の単体テスト (Issue #242)。
 *
 * この判定は「Supabase の自動 pause が近づいていることに人が気づけるか」の
 * 最後の一段であり、境界の向きを間違えると警告が出ないまま本番が落ちる。
 */

import { describe, expect, it } from "vitest";
import {
  KEEPALIVE_STALE_AFTER_HOURS,
  isKeepaliveStale,
} from "../keepalive";

const NOW = new Date("2026-09-05T00:00:00.000Z");

/** NOW から `hours` 時間前の ISO 文字列。 */
function hoursAgo(hours: number): string {
  return new Date(NOW.getTime() - hours * 3_600_000).toISOString();
}

describe("isKeepaliveStale", () => {
  it("記録が無ければ異常扱いにする (一度も届いていない = cron 未登録の疑い)", () => {
    expect(isKeepaliveStale(null, NOW)).toBe(true);
    expect(isKeepaliveStale(undefined, NOW)).toBe(true);
    expect(isKeepaliveStale("", NOW)).toBe(true);
  });

  it("パースできない値は異常扱いにする (fail-closed)", () => {
    expect(isKeepaliveStale("not-a-timestamp", NOW)).toBe(true);
  });

  it("平常の間隔 (約 12 時間前) は正常", () => {
    expect(isKeepaliveStale(hoursAgo(12), NOW)).toBe(false);
  });

  it("閾値ちょうどは正常、超えたら異常", () => {
    expect(isKeepaliveStale(hoursAgo(KEEPALIVE_STALE_AFTER_HOURS), NOW)).toBe(false);
    expect(isKeepaliveStale(hoursAgo(KEEPALIVE_STALE_AFTER_HOURS + 0.1), NOW)).toBe(true);
  });

  it("閾値は 2 系統が連続で落ちたときだけ踏む値になっている", () => {
    // Vercel 21:00 UTC / GHA 09:00 UTC で平常の間隔は約 12 時間。Hobby の
    // ±59 分ジッタを見ても 13 時間には収まる。閾値がそこに近いと平常運転で
    // 誤警告が出て狼少年化する。
    expect(KEEPALIVE_STALE_AFTER_HOURS).toBeGreaterThan(13);
    // 一方、Supabase の pause は 7 日 (168 時間) 無活動で発火する。閾値が
    // そこに近いと気づいたときには手遅れになる。
    expect(KEEPALIVE_STALE_AFTER_HOURS).toBeLessThan(168 / 2);
  });

  it("未来の時刻は異常扱いにしない (クロック差で誤警告しない)", () => {
    expect(isKeepaliveStale(hoursAgo(-1), NOW)).toBe(false);
  });
});
