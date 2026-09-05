import { NextResponse } from "next/server";
import type { DbSnapshot } from "@/lib/db/snapshot";
import { repos } from "@/lib/repositories";
import { today } from "@/lib/utils/date";
import { requireSignedIn } from "@/lib/actions/_authz";

// Runtime: Node.js 固定。
// postgres.js は Edge ランタイム非対応のため、本ルートは Node.js でしか
// 動作してはならない。
// Next.js 16 + Cache Components (`nextConfig.cacheComponents = true`) では
// Node.js runtime が強制され、`export const runtime = "..."` の Route
// Segment Config 宣言自体がビルドエラーとなるため、ここでは明示宣言できない
// (cf. node_modules/next/dist/docs/01-app/02-guides/migrating-to-cache-components.md
//      §「runtime = 'edge'」: "Cache Components requires the Node.js runtime")。
// design.md §「`app/api/export/route.ts` (修正)」の "runtime nodejs 明示宣言"
// は、ビルドシステム側でより強く保証されているためコメント化のみとする。

export async function GET() {
  // 認証ゲート。`proxy.ts` の `config.matcher` は `/api/*` を除外しており、
  // Route Handler は proxy に守られない。本 route は DB スナップショット全件
  // (店舗の連絡先・商談の見積/受注額・失注理由を含む) を返すため、認可は
  // このハンドラ自身が持つ必要がある。
  //
  // ロールは問わない。設定画面の #155 の判断 (`data-actions.tsx`: リセット /
  // 全削除 / インポートは admin 限定、「Export は非破壊のためゲートしない」)
  // に合わせ、要求は「ログイン済みであること」に留める。admin 限定へ絞るかは
  // 別途の運用ポリシー判断とする。
  const denied = await requireSignedIn();
  if (denied) {
    console.warn("[authz] denied", {
      action: "data.export",
      reason: "unauthenticated",
    });
    // `requireSignedIn` は拒否時のみ ActionResult を返す契約だが、戻り値の型は
    // ActionResult<never> の union なので失敗側へ絞ってから文言を取り出す。
    // 絞れなかった場合も fail-closed で 401 にする (非 null = 拒否)。
    const message = denied.ok === false ? denied.error : "ログインが必要です";
    return NextResponse.json({ error: message }, { status: 401 });
  }

  // 3 entity を DB から並列取得 (waterfall 排除、design R5)。
  // research-handoff-db-migration §8.1 / §8.4 で Mock 経由を排除済。
  // Issue #110 で旧 `research` テーブルを撤去したため 4 → 3 entity になった。
  const [deals, stores, handoffs] = await Promise.all([
    repos.deal.list(),
    repos.store.list(),
    repos.handoff.list(),
  ]);
  const snapshot: DbSnapshot = { stores, deals, handoffs };

  const body = JSON.stringify(snapshot, null, 2);
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="firstweb_reserch_ai_${today()}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
