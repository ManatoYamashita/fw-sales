/**
 * `GET /api/cron/keepalive` — Supabase 自動 pause の予防 (Issue #242)
 *
 * Supabase Free は「7 日間 user database activity 無し」で本番 DB を pause する。
 * 2026-06-21 に実際に発火し、middleware の Supabase fetch が刺さって本番が
 * `504 MIDDLEWARE_INVOCATION_TIMEOUT` を返した (#147)。
 *
 * 予防は元々 `.github/workflows/supabase-keepalive.yml` (日次) が担っていたが、
 * GitHub は **public repository の scheduled workflow を 60 日無活動で自動 disable**
 * する。しかも 60 日無活動とは「誰も見ていない期間」そのもので、最も気づかれにくい
 * 局面で keepalive が止まる。本 route はその依存を断つ 2 本目の経路であり、
 * GHA 版とは**恒久的に並走**する (どちらか一方が生きていれば pause しない)。
 *
 * 認可:
 * - Vercel Cron は環境変数 `CRON_SECRET` の値を `Authorization: Bearer <値>` として
 *   自動送信する (Vercel が生成するのではなく、こちらで用意する env var)。
 * - 本番ドメインは Deployment Protection の対象外で公開されているため
 *   (Hobby は production domain を保護できない)、この Bearer 検証が唯一の門になる。
 * - `proxy.ts` の `config.matcher` は `/api/*` を除外しており Route Handler は
 *   proxy に守られない。認可はこのハンドラ自身が持つ (`app/api/export/route.ts` と同じ契約)。
 *
 * Runtime / キャッシュ (いずれも Cache Components 由来の制約):
 * - `export const runtime` は宣言できない。`next.config.ts` の `cacheComponents: true`
 *   が Node runtime を強制しており、宣言自体がビルドエラーになる
 *   (`app/api/export/route.ts` の同趣旨コメント参照)。
 * - `export const dynamic` / `revalidate` も使えない。Cache Components 有効時に
 *   Route Segment Config から削除されている (16.0.0 の Version History。実際
 *   `node_modules/next/dist/docs/.../02-route-segment-config/` に dynamic.md /
 *   revalidate.md は存在しない)。動的性はコードの側で担保するしかない。
 * - Vercel Cron は **キャッシュ応答とリダイレクト応答をログにすら残さない**。
 *   キャッシュされること自体が無言故障になるため `Cache-Control: no-store` を付ける。
 *
 * ★ 処理順序が load-bearing である理由:
 *   Cache Components 有効時、Next.js は **ビルド中に GET ハンドラを実際に実行して**
 *   prerender 可能かを試す (`node_modules/next/dist/export/routes/app-route.js`:
 *   "We don't disable static gen when cacheComponents is enabled because we expect
 *   that anything dynamic in the GET handler will make it dynamic" の直後で
 *   `await module1.handle(request, context)` を呼ぶ)。
 *   `request.headers` へのアクセスがこの prerender を中断させて動的化するので、
 *   **ヘッダ読み取りを DB 書き込みより先に置かなければ `next build` が本番 DB へ
 *   書き込む**。順序を入れ替えてはならない。`__tests__/route.auth.test.ts` が
 *   この順序を機械的に固定している。
 *
 * 関連: Issue #242, Issue #147, .github/workflows/supabase-keepalive.yml
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { repos } from "@/lib/repositories";
import { KEEPALIVE_LAST_RUN_KEY } from "@/lib/domain/keepalive";
import { nowIso } from "@/lib/utils/date";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * `Authorization` ヘッダ全体を、期待値 `Bearer <CRON_SECRET>` と定数時間で比較する。
 *
 * Vercel Cron は env var の値をそのまま `Bearer ` に続けて送るため、比較対象は
 * スキームを含むヘッダ全体である (Vercel 公式サンプルと同じ形)。
 *
 * 長さが違う時点で早期 return すると秘密の長さが漏れるため、SHA-256 で
 * 固定長 (32 バイト) に均してから `timingSafeEqual` に渡す。
 */
function matchesAuthorization(provided: string | null, secret: string): boolean {
  if (provided === null) return false;
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(`Bearer ${secret}`).digest();
  return timingSafeEqual(a, b);
}

export async function GET(request: Request): Promise<NextResponse> {
  // ★ 必ず最初にヘッダを読む (上記「処理順序が load-bearing である理由」参照)。
  const authorization = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  // 設定ミス (env 未設定) と認可失敗 (値の不一致) を別ステータスにする。
  // 前者は 500 = cron の実行履歴が赤くなり「壊れている」と読める。
  // 両方 401 にすると、設定漏れが「正しく拒否できている」ように見えてしまう。
  if (!cronSecret) {
    console.error("[keepalive] misconfigured", {
      reason: "CRON_SECRET is not set",
    });
    return NextResponse.json(
      { error: "keepalive is not configured" },
      { status: 500, headers: NO_STORE },
    );
  }

  if (!matchesAuthorization(authorization, cronSecret)) {
    console.warn("[authz] denied", {
      action: "cron.keepalive",
      reason: authorization === null ? "missing-authorization" : "bad-secret",
    });
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: NO_STORE },
    );
  }

  const startedAt = Date.now();
  const at = nowIso();

  try {
    // upsert は**実書き込み**であり、read より確実に Supabase の
    // "user database activity" として計上される。同じ行を上書きするだけなので
    // 冪等でもある (Vercel Cron は同一スケジュールを重複配送し得る)。
    //
    // 同時に、この行が「cron が実際に DB へ届いた」ことの唯一の事後証跡になる。
    // Vercel の Runtime Logs は Hobby プランでは 1 時間しか残らないため、
    // 翌日以降に確認できる記録は DB 側にしか作れない。
    await repos.appSettings.set(KEEPALIVE_LAST_RUN_KEY, at);
  } catch (error) {
    // 握り潰して 200 を返すと「成功したように見えて DB に触れていない」という
    // 最悪の無言故障になる。必ず 500 にする。
    console.error("[keepalive] failed", {
      key: KEEPALIVE_LAST_RUN_KEY,
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "keepalive query failed" },
      { status: 500, headers: NO_STORE },
    );
  }

  return NextResponse.json(
    { ok: true, at, ms: Date.now() - startedAt },
    { status: 200, headers: NO_STORE },
  );
}
