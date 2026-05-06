/**
 * AI 分析の呼出レート制限。
 *
 * - per-store: 同一 storeId に対し 10 分以内に 5 回を超える呼出を拒否
 * - global: アプリ全体で 60 秒以内に 10 回を超える呼出を拒否
 *
 * 実装はプロセス内 Map ベース。Vercel serverless では cold start ごとに状態消失するが、
 * 社内ツール用途では loose enforcement で十分(research.md Decision 6)。
 * 厳密な分散同期が必要になった時点で Upstash Redis 等に切替検討。
 *
 * 関連: design.md §「RateLimiter」, requirements.md §6.3
 */

import "server-only";

export interface RateLimitOk {
  ok: true;
}

export interface RateLimitDenied {
  ok: false;
  reason: "per_store" | "global";
  message: string;
}

export type RateLimitResult = RateLimitOk | RateLimitDenied;

const PER_STORE_WINDOW_MS = 10 * 60 * 1000; // 10 分
const PER_STORE_MAX = 5;
const GLOBAL_WINDOW_MS = 60 * 1000; // 60 秒
const GLOBAL_MAX = 10;

const perStoreTimestamps = new Map<string, number[]>();
const globalTimestamps: number[] = [];

function pruneOlderThan(arr: number[], threshold: number): number[] {
  return arr.filter((t) => t >= threshold);
}

/**
 * レート制限をチェックし、許可/拒否を返す。
 *
 * - 拒否時はカウントを進めない(API コスト発生前の防御)
 * - 許可時は per-store(storeId が non-null の場合) と global の両方にタイムスタンプを記録
 *
 * @param storeId - 店舗 ID。新規登録など ID 未確定時は null を渡す(per-store 判定をスキップ)
 */
export function checkRateLimit(storeId: string | null): RateLimitResult {
  const now = Date.now();

  // global cleanup + check
  const globalRecent = pruneOlderThan(globalTimestamps, now - GLOBAL_WINDOW_MS);
  globalTimestamps.length = 0;
  globalTimestamps.push(...globalRecent);

  if (globalTimestamps.length >= GLOBAL_MAX) {
    return {
      ok: false,
      reason: "global",
      message: `分析の連続実行を制限中です(60 秒以内に ${GLOBAL_MAX} 回以上)。しばらくお待ちください。`,
    };
  }

  // per-store cleanup + check (storeId が null なら skip)
  if (storeId !== null) {
    const recent = pruneOlderThan(
      perStoreTimestamps.get(storeId) ?? [],
      now - PER_STORE_WINDOW_MS,
    );
    if (recent.length >= PER_STORE_MAX) {
      perStoreTimestamps.set(storeId, recent);
      return {
        ok: false,
        reason: "per_store",
        message: `この店舗の連続分析を制限中です(10 分以内に ${PER_STORE_MAX} 回以上)。しばらくお待ちください。`,
      };
    }
    recent.push(now);
    perStoreTimestamps.set(storeId, recent);
  }

  globalTimestamps.push(now);
  return { ok: true };
}

/**
 * テスト専用のリセット関数。production では呼ばないこと。
 *
 * @internal
 */
export function _resetRateLimitForTest(): void {
  perStoreTimestamps.clear();
  globalTimestamps.length = 0;
}
