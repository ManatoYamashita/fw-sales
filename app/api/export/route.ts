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
    // DB モード: 4 entity を DB から並列取得 (waterfall 排除、design R5)。
    // research-handoff-db-migration §8.1 / §8.4 で Mock 経由を排除済。
    const [deals, stores, research, handoffs] = await Promise.all([
      repos.deal.list(),
      repos.store.list(),
      repos.research.list(),
      repos.handoff.list(),
    ]);
    snapshot = { stores, research, deals, handoffs };
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
