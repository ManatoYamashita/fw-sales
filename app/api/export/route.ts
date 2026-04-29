import { NextResponse } from "next/server";
import { snapshotMockDb } from "@/lib/mock/db";
import { today } from "@/lib/utils/date";

export async function GET() {
  const snapshot = snapshotMockDb();
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
