/**
 * GitHub Actions cron からの POST 受口 (deep-research-pipeline spec #43, Task 4.1)
 *
 * - Bearer `CRON_SECRET` 認可必須 (R6.4, R6.5)
 * - `maxDuration = 60`、`deadline = Date.now() + 55_000`
 * - 中核ロジックは `pipeline.ts:runPollResearchTick` に委譲 (テスト容易性)
 *
 * 関連: requirements.md §2.1, §2.5, §6.4, §6.5
 */

import { NextResponse } from "next/server";
import { runPollResearchTick } from "./pipeline";
import { readEnv } from "@/lib/env";

// Next.js 16 Cache Components 環境では `dynamic = "force-dynamic"` は宣言不可
// (nextConfig.cacheComponents との互換性なしでビルドエラー)。
// POST + Authorization ヘッダ参照のため自動的に dynamic として扱われる。
export const maxDuration = 60;

const DEADLINE_SAFETY_MS = 55_000;

export async function POST(request: Request): Promise<Response> {
  const secret = readEnv("CRON_SECRET");
  if (!secret) {
    // 運用 misconfig: 認可不可能なため 503 を返す (401 だと「鍵間違い」と区別不能)
    return new NextResponse("Service Unavailable", { status: 503 });
  }

  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    // ボディは出さずブルートフォース対策
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const deadline = Date.now() + DEADLINE_SAFETY_MS;
  try {
    const result = await runPollResearchTick({ deadline });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    // 例外は中身を露出せず 500 を返す。次 tick でリトライ。
    const message =
      err instanceof Error ? err.message : "unknown error";
    return NextResponse.json(
      { error: "pipeline_failed", detail: sanitize(message) },
      { status: 500 },
    );
  }
}

/** エラー文字列から API キーらしき値を雑に除去する (生エラー漏出防止)。 */
function sanitize(text: string): string {
  // ありがちな API キー prefix (AIza...) を伏字化
  return text.replace(/AIza[A-Za-z0-9_-]{10,}/g, "AIza***");
}
