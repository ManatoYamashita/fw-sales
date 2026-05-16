/**
 * 商談リマインダー Vercel Cron Route Handler (auth-and-notifications spec, Issue #16)
 *
 * Vercel Cron が `?mode=tomorrow` (前日朝 JST 7:00 = UTC 22:00) /
 * `?mode=today` (当日朝 JST 8:00 = UTC 23:00) の 2 回起動する。
 *
 * 認証:
 * - `Authorization: Bearer ${CRON_SECRET}` 必須。不一致 / `CRON_SECRET` 未設定 → 401
 *   (Req 6.8 / 8.3)
 *
 * 動作:
 * 1. `mode` クエリ検証 (`tomorrow` / `today` 以外 → 400)
 * 2. `getDealsDueSoon(mode)` 結果が 0 件 → 早期 return + `{ sent: 0, ... }` 200
 * 3. 1 件以上 → 担当者ごとに `buildDealReminderEmail` でメッセージ生成 →
 *    `emailClient.send()` で送信、個別失敗は error ログのみで全体は 200
 *    (Req 6.5, 6.6, 4.1〜4.3)
 *
 * 関連: design.md §「Cron Route」, requirements.md §6.1〜6.8
 */

import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { getDealsDueSoon } from "@/lib/queries/deals-due-soon";
import {
  buildDealReminderEmail,
  emailClient,
  type DealReminderMode,
} from "@/lib/email";

/**
 * メール本文の店舗詳細リンク生成用ベース URL。
 * 未設定時は dev フォールバック (`http://localhost:3000`) を返す。
 */
function getAppBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

function isValidMode(value: string | null): value is DealReminderMode {
  return value === "tomorrow" || value === "today";
}

interface CronSummary {
  readonly mode: DealReminderMode;
  readonly bundles: number;
  readonly sent: number;
  readonly skipped: number;
  readonly failed: number;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  // ===== 1. CRON_SECRET 検証 =====
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ===== 2. mode クエリ検証 =====
  const mode = request.nextUrl.searchParams.get("mode");
  if (!isValidMode(mode)) {
    return NextResponse.json(
      { error: "Invalid mode. Use ?mode=tomorrow or ?mode=today" },
      { status: 400 },
    );
  }

  // ===== 3. 対象 bundle 取得 =====
  const bundles = await getDealsDueSoon(mode);
  if (bundles.length === 0) {
    const summary: CronSummary = {
      mode,
      bundles: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
    };
    return NextResponse.json(summary);
  }

  // ===== 4. 担当者ごとに送信 =====
  const appBaseUrl = getAppBaseUrl();
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const bundle of bundles) {
    try {
      const message = await buildDealReminderEmail({
        profile: bundle.profile,
        mode,
        deals: bundle.deals,
        appBaseUrl,
      });
      const result = await emailClient.send(message);
      if (result.kind === "ok") sent++;
      else if (result.kind === "noop") skipped++;
      else failed++;
    } catch (err) {
      failed++;
      console.error(
        `[cron/deal-reminders] send failed for user_id=${bundle.profile.id}:`,
        err,
      );
    }
  }

  const summary: CronSummary = {
    mode,
    bundles: bundles.length,
    sent,
    skipped,
    failed,
  };
  return NextResponse.json(summary);
}
