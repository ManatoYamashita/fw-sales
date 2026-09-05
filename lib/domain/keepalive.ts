/**
 * Supabase keepalive の共有定数と鮮度判定 (Issue #242)。
 *
 * cron endpoint (`app/api/cron/keepalive/route.ts`) が書き、設定画面が読む。
 * 両者が同じキー・同じ閾値を指していることをこのモジュールで固定する。
 *
 * 関連: Issue #242, Issue #147 (pause による本番 504),
 *       .github/workflows/supabase-keepalive.yml (並走する GitHub Actions 版)
 */

/**
 * `app_settings` に最終実行時刻 (ISO 8601) を記録するキー。
 *
 * 値の側に ISO 文字列を入れることが重要で、`app_settings.updated_at` は
 * `YYYY-MM-DD` の日付粒度しか持たない (`lib/db/app-settings-repository.ts` が
 * `today()` を書く) ため、時刻精度は value にしか存在しない。
 *
 * Vercel の Runtime Logs は Hobby プランでは 1 時間しか残らないため、
 * 「cron が実際に DB へ届いたか」を後から確認できる証跡はこの行だけである。
 */
export const KEEPALIVE_LAST_RUN_KEY = "keepalive_last_run_at";

/**
 * この時間を超えて更新が無ければ「異常」と扱う。
 *
 * Vercel Cron は 21:00 UTC、GitHub Actions 版は 09:00 UTC で、平常時の間隔は
 * 約 12 時間 (Hobby の ±59 分ジッタを見ても約 13 時間)。48 時間は
 * 「Vercel 側が 2 回連続で落ちた」に相当し、平常のばらつきでは踏まない。
 *
 * Supabase Free の自動 pause は「7 日間 user database activity 無し」で発火する。
 * 48 時間で気づけば手を打つ余地が 5 日残る。
 */
export const KEEPALIVE_STALE_AFTER_HOURS = 48;

/**
 * 最終実行時刻が古すぎるか (= keepalive が機能していない疑いがあるか) を判定する。
 *
 * 記録が無い場合も `true`。「一度も届いていない」は「止まった」と同じか、
 * cron が最初から登録されていない分むしろ悪いため、区別せず異常側に倒す。
 * パースできない値も異常扱いにする (fail-closed)。
 */
export function isKeepaliveStale(
  lastRunIso: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!lastRunIso) return true;
  const last = new Date(lastRunIso);
  if (Number.isNaN(last.getTime())) return true;
  const elapsedHours = (now.getTime() - last.getTime()) / 3_600_000;
  return elapsedHours > KEEPALIVE_STALE_AFTER_HOURS;
}
