import { NextResponse } from "next/server";
import { snapshotMockDb, type DbSnapshot } from "@/lib/mock/db";
import { repos } from "@/lib/repositories";
import { today } from "@/lib/utils/date";

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

function isMockMode(): boolean {
  return process.env.USE_MOCK_DB === "true";
}

export async function GET() {
  let snapshot: DbSnapshot;

  if (isMockMode()) {
    // Mock モード: Mock DB から一括 snapshot を取得。
    snapshot = snapshotMockDb();
  } else {
    // DB モード:
    // - Deal / Store は DB から並列取得 (waterfall 排除、design R5)
    // - Research / Handoff は Mock の該当部分を抽出
    //   (これらは別 Issue で DB 化される予定)
    const [deals, stores, mock] = await Promise.all([
      repos.deal.list(),
      repos.store.list(),
      Promise.resolve(snapshotMockDb()),
    ]);
    snapshot = {
      stores,
      research: mock.research,
      deals,
      handoffs: mock.handoffs,
    };
  }

  const body = JSON.stringify(snapshot, null, 2);
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="firstweb_lead_os_${today()}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
